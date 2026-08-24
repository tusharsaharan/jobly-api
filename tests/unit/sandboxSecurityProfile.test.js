const {
  SECCOMP_BPF_PROFILE,
  CGROUPS_V2_CONFIG,
  generateContainerSecurityArgs,
} = require("../../src/infrastructure/sandbox/sandboxSecurityProfile");

describe("Sandbox Security Profile & Linux Isolation Unit Tests", () => {
  describe("SECCOMP_BPF_PROFILE Specification", () => {
    it("should have secure default action (SCMP_ACT_ERRNO)", () => {
      expect(SECCOMP_BPF_PROFILE.defaultAction).toBe("SCMP_ACT_ERRNO");
      expect(SECCOMP_BPF_PROFILE.architectures).toContain("SCMP_ARCH_X86_64");
    });

    it("should strictly kill dangerous kernel & network syscalls", () => {
      const killRule = SECCOMP_BPF_PROFILE.syscalls.find((s) => s.action === "SCMP_ACT_KILL");
      expect(killRule).toBeDefined();
      expect(killRule.names).toContain("socket");
      expect(killRule.names).toContain("connect");
      expect(killRule.names).toContain("bind");
      expect(killRule.names).toContain("ptrace");
      expect(killRule.names).toContain("kill");
      expect(killRule.names).toContain("setuid");
      expect(killRule.names).toContain("chroot");
    });

    it("should explicitly allow safe execution syscalls", () => {
      const allowRule = SECCOMP_BPF_PROFILE.syscalls.find((s) => s.action === "SCMP_ACT_ALLOW");
      expect(allowRule).toBeDefined();
      expect(allowRule.names).toContain("read");
      expect(allowRule.names).toContain("write");
      expect(allowRule.names).toContain("mmap");
      expect(allowRule.names).toContain("brk");
      expect(allowRule.names).toContain("exit_group");
    });
  });

  describe("CGROUPS_V2_CONFIG Specification", () => {
    it("should bound memory, CPU, and PIDs to prevent denial-of-service", () => {
      expect(CGROUPS_V2_CONFIG.pidsMax).toBe(32); // Fork bomb protection
      expect(CGROUPS_V2_CONFIG.memoryMaxBytes).toBe(268435456); // 256MB limit
      expect(CGROUPS_V2_CONFIG.cpuMax).toBe("100000 100000"); // 1 CPU quota
    });
  });

  describe("generateContainerSecurityArgs", () => {
    it("should generate hardened container runtime flags", () => {
      const args = generateContainerSecurityArgs({ memoryMb: 256, pidsLimit: 32 });
      expect(args).toContain("--cap-drop");
      expect(args).toContain("ALL");
      expect(args).toContain("--security-opt");
      expect(args).toContain("no-new-privileges:true");
      expect(args).toContain("--network");
      expect(args).toContain("none");
      expect(args).toContain("--pids-limit=32");
      expect(args).toContain("--memory=256m");
    });
  });
});
