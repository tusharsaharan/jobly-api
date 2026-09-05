const { classifyIntent, generateLinkedInSmartReplies } = require("../../src/modules/messages/smartReplyEngine");

describe("LinkedIn-Grade Smart Reply Engine", () => {
  describe("Dialogue Act Intent Classification", () => {
    test("detects AVAILABILITY_INQUIRY intent", () => {
      expect(classifyIntent("When are you free for a call this week?")).toBe("AVAILABILITY_INQUIRY");
      expect(classifyIntent("Could you share your availability for tomorrow?")).toBe("AVAILABILITY_INQUIRY");
      expect(classifyIntent("What times work for you?")).toBe("AVAILABILITY_INQUIRY");
    });

    test("detects TIME_PROPOSAL intent", () => {
      expect(classifyIntent("How does 2 PM sound?")).toBe("TIME_PROPOSAL");
      expect(classifyIntent("Let's connect on Thursday at 4 PM.")).toBe("TIME_PROPOSAL");
      expect(classifyIntent("Can you do Friday at 10 AM?")).toBe("TIME_PROPOSAL");
    });

    test("detects INTERVIEW_INVITATION intent", () => {
      expect(classifyIntent("I've invited you to a technical interview studio.")).toBe("INTERVIEW_INVITATION");
      expect(classifyIntent("Please join the interview room.")).toBe("INTERVIEW_INVITATION");
    });

    test("detects PORTFOLIO_REQUEST intent", () => {
      expect(classifyIntent("Could you share your GitHub or code samples?")).toBe("PORTFOLIO_REQUEST");
      expect(classifyIntent("Can you provide links to your recent projects?")).toBe("PORTFOLIO_REQUEST");
    });

    test("detects SALARY_INQUIRY intent", () => {
      expect(classifyIntent("What are your salary expectations for this position?")).toBe("SALARY_INQUIRY");
    });

    test("detects EMPTY_THREAD intent", () => {
      expect(classifyIntent("")).toBe("EMPTY_THREAD");
      expect(classifyIntent(null)).toBe("EMPTY_THREAD");
    });
  });

  describe("Multi-Turn Conversation State & 3-Cluster MMR Diversity", () => {
    const counterpartRecruiter = { _id: "rec-1", name: "Sarah Chen", role: "recruiter" };
    const counterpartCandidate = { _id: "cand-1", name: "Alex Rivera", role: "seeker" };
    const jobInfo = { title: "Staff Frontend Architect", company: "TechCorp Systems", skills: ["React", "TypeScript"] };

    test("generates thread starters for new conversations (Candidate perspective)", () => {
      const replies = generateLinkedInSmartReplies({
        messages: [],
        userRole: "seeker",
        counterpart: counterpartRecruiter,
        job: jobInfo,
      });

      expect(replies.length).toBe(3);
      expect(replies[0]).toContain("Sarah Chen");
      expect(replies[0]).toContain("Staff Frontend Architect");
    });

    test("generates thread starters for new conversations (Recruiter perspective)", () => {
      const replies = generateLinkedInSmartReplies({
        messages: [],
        userRole: "recruiter",
        counterpart: counterpartCandidate,
        job: jobInfo,
      });

      expect(replies.length).toBe(3);
      expect(replies[0]).toContain("Alex Rivera");
      expect(replies[0]).toContain("Staff Frontend Architect");
    });

    test("suggests accurate availability responses with MMR diversity when recruiter asks for availability", () => {
      const messages = [
        {
          _id: "m-1",
          sender: "rec-1",
          text: "Hi Alex, when are you free for a quick technical chat this week?",
        },
      ];

      const replies = generateLinkedInSmartReplies({
        messages,
        userRole: "seeker",
        currentUserId: "cand-1",
        counterpart: counterpartRecruiter,
        job: jobInfo,
      });

      expect(replies.length).toBe(3);
      // Response 1: Scheduling confirm (available)
      expect(replies[0]).toContain("available");
      // Response 2: Alternative slot
      expect(replies[1]).toContain("schedule");
      // Response 3: Acknowledgment
      expect(replies[2]).toContain("letting me know");
    });

    test("suggests follow-up nudges when current user was the last to speak", () => {
      const messages = [
        {
          _id: "m-1",
          sender: "rec-1",
          text: "Hi Alex, nice to connect!",
        },
        {
          _id: "m-2",
          sender: "cand-1",
          text: "Hi Sarah! I've shared my resume and portfolio.",
        },
      ];

      const replies = generateLinkedInSmartReplies({
        messages,
        userRole: "seeker",
        currentUserId: "cand-1", // Candidate sent last message
        counterpart: counterpartRecruiter,
        job: jobInfo,
      });

      expect(replies.length).toBe(3);
      expect(replies[0]).toContain("following up");
    });

    test("suggests confirmation responses when recruiter sends interview invitation", () => {
      const messages = [
        {
          _id: "m-2",
          sender: "rec-1",
          text: "I've scheduled your live coding interview in the technical studio.",
        },
      ];

      const replies = generateLinkedInSmartReplies({
        messages,
        userRole: "seeker",
        currentUserId: "cand-1",
        counterpart: counterpartRecruiter,
        job: jobInfo,
      });

      expect(replies.length).toBe(3);
      expect(replies[0]).toContain("studio");
      expect(replies[1]).toContain("Yes, absolutely!");
    });
  });
});
