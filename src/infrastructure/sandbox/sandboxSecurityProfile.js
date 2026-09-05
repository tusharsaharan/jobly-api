/**
 * Linux Seccomp-BPF Syscall Filtering Profile & Cgroups v2 Specifications
 * Compatible with Docker, Containerd, Podman, and OCI runtimes.
 */

const SECCOMP_BPF_PROFILE = {
  defaultAction: "SCMP_ACT_ERRNO",
  architectures: ["SCMP_ARCH_X86_64", "SCMP_ARCH_X86", "SCMP_ARCH_AARCH64"],
  syscalls: [
    {
      names: [
        "read",
        "write",
        "openat",
        "close",
        "fstat",
        "lseek",
        "mmap",
        "mprotect",
        "munmap",
        "brk",
        "rt_sigaction",
        "rt_sigprocmask",
        "rt_sigreturn",
        "ioctl",
        "access",
        "pipe2",
        "select",
        "pselect6",
        "poll",
        "ppoll",
        "futex",
        "gettimeofday",
        "clock_gettime",
        "clock_nanosleep",
        "nanosleep",
        "exit",
        "exit_group",
        "arch_prctl",
        "getpid",
        "gettid",
        "getuid",
        "getgid",
        "geteuid",
        "getegid",
        "sched_yield",
        "getrandom",
        "getcwd",
        "readlinkat",
        "newfstatat",
      ],
      action: "SCMP_ACT_ALLOW",
    },
    {
      names: [
        "socket",
        "connect",
        "bind",
        "listen",
        "accept",
        "accept4",
        "sendto",
        "recvfrom",
        "sendmsg",
        "recvmsg",
        "shutdown",
        "getsockname",
        "getpeername",
        "setsockopt",
        "getsockopt",
        "ptrace",
        "bpf",
        "perf_event_open",
        "kill",
        "reboot",
        "setuid",
        "setgid",
        "chroot",
        "mount",
        "umount2",
        "pivot_root",
        "init_module",
        "delete_module",
      ],
      action: "SCMP_ACT_KILL",
    },
  ],
};

const CGROUPS_V2_CONFIG = {
  // CPU: 100,000 microseconds (100ms) quota per 100,000 microseconds period = 1 CPU core max
  cpuMax: "100000 100000",
  cpuWeight: "100",
  // Memory: 256MB hard limit (OOM kill if exceeded), 200MB soft throttle
  memoryMaxBytes: 268435456, // 256 * 1024 * 1024
  memoryHighBytes: 209715200, // 200 * 1024 * 1024
  // PIDs: Maximum 32 concurrent processes/threads (anti-fork-bomb barrier)
  pidsMax: 32,
};

/**
 * Generate standard OCI / Docker container execution arguments
 */
function generateContainerSecurityArgs({
  memoryMb = 256,
  cpuCores = 1.0,
  pidsLimit = 32,
  readOnlyRoot = true,
  disableNetworking = true,
} = {}) {
  const args = [
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    `--memory=${memoryMb}m`,
    `--cpus=${cpuCores}`,
    `--pids-limit=${pidsLimit}`,
  ];

  if (disableNetworking) {
    args.push("--network", "none");
  }

  if (readOnlyRoot) {
    args.push(
      "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
      "--tmpfs", "/run:rw,noexec,nosuid,size=16m"
    );
  }

  return args;
}

module.exports = {
  SECCOMP_BPF_PROFILE,
  CGROUPS_V2_CONFIG,
  generateContainerSecurityArgs,
};
