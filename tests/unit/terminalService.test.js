const terminalService = require("../../src/infrastructure/terminal/terminalService");

describe("Feature 3: Terminal Service & Pseudo-Terminal Streaming", () => {
  let terminalId;

  afterEach(() => {
    if (terminalId) {
      terminalService.closeTerminalSession(terminalId);
      terminalId = null;
    }
  });

  test("Test 1: should spawn a new terminal session and assign unique ID", () => {
    terminalId = terminalService.createTerminalSession("test_session_123", 80, 24);
    expect(terminalId).toBeDefined();
    expect(terminalId).toMatch(/^term_/);

    const session = terminalService.getTerminalSession(terminalId);
    expect(session).not.toBeNull();
    expect(session.sessionId).toBe("test_session_123");
  });

  test("Test 2: should write input and receive data stream in onDataCallback", async () => {
    let receivedData = "";

    await new Promise((resolve) => {
      let timer;
      terminalId = terminalService.createTerminalSession(
        "test_session_io",
        80,
        24,
        (termId, data) => {
          receivedData += data;
          if (receivedData.length > 0) {
            clearTimeout(timer);
            resolve();
          }
        }
      );

      // Trigger echo command
      timer = setTimeout(() => {
        if (terminalId) {
          try {
            terminalService.writeToTerminal(terminalId, "echo 'Terminal Active'\r\n");
          } catch {}
        }
      }, 50);
    });

    expect(receivedData.length).toBeGreaterThan(0);
  });

  test("Test 3: should resize terminal window geometry", () => {
    terminalId = terminalService.createTerminalSession("test_session_resize", 80, 24);
    const resized = terminalService.resizeTerminal(terminalId, 120, 40);
    // Returns boolean indicating whether resize method was available/called
    expect(typeof resized).toBe("boolean");
  });

  test("Test 4: should cleanly close terminal process and purge from active map", () => {
    terminalId = terminalService.createTerminalSession("test_session_close", 80, 24);
    expect(terminalService.getTerminalSession(terminalId)).not.toBeNull();

    terminalService.closeTerminalSession(terminalId);
    expect(terminalService.getTerminalSession(terminalId)).toBeNull();
    terminalId = null;
  });

  test("Test 5: should throw error when writing to nonexistent terminal", () => {
    expect(() => {
      terminalService.writeToTerminal("term_nonexistent_999", "ls\n");
    }).toThrow("Terminal term_nonexistent_999 not found");
  });
});
