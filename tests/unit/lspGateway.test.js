const WebSocket = require("ws");
const http = require("http");
const jwt = require("jsonwebtoken");
const app = require("../../src/app");
const config = require("../../src/config/env");
const { handleLspUpgrade, getLanguageServerCommand } = require("../../src/infrastructure/lsp/lspGateway");

const User = require("../../src/models/User");
const Job = require("../../src/models/Job");
const Application = require("../../src/models/Application");
const InterviewSession = require("../../src/models/InterviewSession");

describe("Feature 12: LSP (Language Server Protocol) Gateway", () => {
  let server;
  let port;
  let seekerUser;
  let recruiterUser;
  let outsiderUser;
  let sessionDoc;
  let seekerToken;
  let outsiderToken;
  let roomKey;

  beforeAll(async () => {
    server = http.createServer(app);

    server.on("upgrade", async (req, socket, head) => {
      const pathname = req.url ? req.url.split("?")[0] : "";
      if (pathname.startsWith("/lsp/")) {
        const handled = await handleLspUpgrade(req, socket, head);
        if (handled) return;
      }
      socket.destroy();
    });

    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  beforeEach(async () => {
    seekerUser = await User.create({
      name: "Seeker Dev",
      email: `seeker_lsp_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_lsp",
    });

    recruiterUser = await User.create({
      name: "Recruiter Pro",
      email: `recruiter_lsp_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "recruiter",
      tenantId: "tenant_lsp",
    });

    outsiderUser = await User.create({
      name: "Outsider User",
      email: `outsider_lsp_${Date.now()}_${Math.random()}@example.com`,
      password: "password123",
      role: "seeker",
      tenantId: "tenant_lsp",
    });

    const jobDoc = await Job.create({
      title: "Senior Compiler Engineer",
      description: "LSP and parser specialist.",
      company: "DevTools Inc",
      recruiter: recruiterUser._id,
      tenantId: "tenant_lsp",
    });

    const appDoc = await Application.create({
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      tenantId: "tenant_lsp",
    });

    roomKey = `room-lsp-test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    sessionDoc = await InterviewSession.create({
      tenantId: "tenant_lsp",
      application: appDoc._id,
      job: jobDoc._id,
      seeker: seekerUser._id,
      recruiter: recruiterUser._id,
      roomKey,
      scheduledStart: new Date(),
    });

    seekerToken = jwt.sign(
      { id: seekerUser._id.toString(), userId: seekerUser._id.toString(), role: "seeker" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );

    outsiderToken = jwt.sign(
      { id: outsiderUser._id.toString(), userId: outsiderUser._id.toString(), role: "seeker" },
      config.JWT_SECRET || process.env.JWT_SECRET || "development_secret_key_12345678"
    );
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test("Test 1: should resolve language server command for supported languages", () => {
    const ts = getLanguageServerCommand("typescript");
    expect(ts).not.toBeNull();
    expect(ts.cmd).toBe("typescript-language-server");

    const py = getLanguageServerCommand("python");
    expect(py).not.toBeNull();
    expect(py.cmd).toBe("pyright-langserver");

    const cpp = getLanguageServerCommand("cpp");
    expect(cpp).not.toBeNull();
    expect(cpp.cmd).toBe("clangd");
  });

  test("Test 2: should reject connection with 401 when token is invalid or missing", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/lsp/${roomKey}/python?token=bad_token`);
    const rejected = await new Promise((resolve) => {
      ws.on("error", () => resolve(true));
      ws.on("close", () => resolve(true));
      ws.on("open", () => resolve(false));
    });
    expect(rejected).toBe(true);
  });

  test("Test 3: should reject non-participant from connecting to LSP socket", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/lsp/${roomKey}/python?token=${outsiderToken}`);
    const rejected = await new Promise((resolve) => {
      ws.on("error", () => resolve(true));
      ws.on("close", () => resolve(true));
      ws.on("open", () => resolve(false));
    });
    expect(rejected).toBe(true);
  });

  test("Test 4: should connect authenticated participant and respond to JSON-RPC initialize", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/lsp/${roomKey}/python?token=${seekerToken}`);

    await new Promise((resolve) => ws.on("open", resolve));

    const responsePromise = new Promise((resolve) => {
      ws.on("message", (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    const initMessage = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { processId: 1, rootUri: null, capabilities: {} },
    });

    ws.send(initMessage);

    const resp = await responsePromise;
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
    expect(resp.result.capabilities).toBeDefined();

    ws.close();
  });
});
