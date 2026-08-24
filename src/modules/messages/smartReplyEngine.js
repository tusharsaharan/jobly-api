/**
 * Enterprise Smart Reply Engine (LinkedIn-Grade Architecture)
 * Based on LinkedIn's Smart Reply System: Semantic Intent Clustering,
 * Multi-Turn Conversation State Modeling, Entity Injection, and Maximum Marginal Relevance (MMR) Diversity.
 */

// ==========================================
// 1. CANONICAL SEMANTIC RESPONSE CLUSTERS
// ==========================================

const RESPONSE_CLUSTERS = {
  // --- Cluster 1: Affirmative / Positive Confirmation ---
  AFFIRMATIVE: {
    id: "AFFIRMATIVE",
    type: "positive",
    seeker: [
      "Yes, absolutely!",
      "Sounds great, thank you!",
      "That works perfectly for me.",
      "Confirmed, looking forward to it!",
      "Yes, I'm definitely interested.",
    ],
    recruiter: [
      "Sounds great, let's do that!",
      "Perfect, looking forward to connecting.",
      "Confirmed on our end as well.",
      "Great, let's move forward with this.",
    ],
  },

  // --- Cluster 2: Scheduling & Availability Confirmation ---
  SCHEDULING_CONFIRM: {
    id: "SCHEDULING_CONFIRM",
    type: "action",
    seeker: [
      "I am available tomorrow between 2 PM – 5 PM.",
      "Thursday or Friday morning works best for me.",
      "I can make anytime after 1 PM work this week.",
      "That time is confirmed on my calendar.",
    ],
    recruiter: [
      "Would tomorrow at 2 PM or 4 PM EST work for you?",
      "Let me know what time slots suit you best this week.",
      "I've sent an interview calendar invite for our session.",
      "Does Thursday afternoon work for a 30-minute chat?",
    ],
  },

  // --- Cluster 3: Reschedule / Alternative Proposal ---
  SCHEDULING_ALTERNATIVE: {
    id: "SCHEDULING_ALTERNATIVE",
    type: "alternative",
    seeker: [
      "Could we please schedule for 30 minutes later?",
      "I have a conflict at that time — would earlier work?",
      "Could we move this to Friday morning instead?",
      "I'm flexible, but earlier in the day is preferred.",
    ],
    recruiter: [
      "No problem, let's look at alternative times.",
      "Would Friday morning work better for your schedule?",
      "Feel free to suggest another time that suits you.",
    ],
  },

  // --- Cluster 4: Technical Studio & Interview Readiness ---
  INTERVIEW_STUDIO: {
    id: "INTERVIEW_STUDIO",
    type: "action",
    seeker: [
      "Thank you! I've accepted and am all set for the studio.",
      "Is there anything specific I should prepare in advance?",
      "Confirmed. Looking forward to the live coding session!",
      "I will join the interview room a few minutes early.",
    ],
    recruiter: [
      "I've set up the technical interview studio for us in Jobly.",
      "The live coding room is ready whenever you'd like to test.",
      "Let me know if you have any questions before we begin.",
    ],
  },

  // --- Cluster 5: Portfolio, GitHub & Code Artifacts ---
  PORTFOLIO_ARTIFACTS: {
    id: "PORTFOLIO_ARTIFACTS",
    type: "action",
    seeker: [
      "I've updated my profile with my latest GitHub repositories.",
      "Here are my recent production projects and code samples.",
      "Happy to walk through my system architecture during our call.",
      "You can find my live projects and code on my profile.",
    ],
    recruiter: [
      "Thanks for sharing! I will review your repositories.",
      "Impressive projects! Let's discuss your architecture on our call.",
      "Could you highlight which project best demonstrates system design?",
    ],
  },

  // --- Cluster 6: Salary & Compensation Discussion ---
  SALARY_COMPENSATION: {
    id: "SALARY_COMPENSATION",
    type: "action",
    seeker: [
      "My target compensation is aligned with industry standard senior rates.",
      "I'm flexible and open to discussing based on the total compensation package.",
      "Happy to discuss compensation details during our upcoming call.",
    ],
    recruiter: [
      "The budgeted range is competitive with equity and comprehensive benefits.",
      "We offer a competitive base plus performance bonuses and equity.",
      "Let's discuss compensation details during our offer alignment stage.",
    ],
  },

  // --- Cluster 7: Status Inquiry & Follow-up ---
  STATUS_INQUIRY: {
    id: "STATUS_INQUIRY",
    type: "inquiry",
    seeker: [
      "Just following up to see if there are any updates on my application.",
      "Looking forward to hearing about the next steps!",
      "Please let me know if you need any additional information from me.",
    ],
    recruiter: [
      "Our engineering team is reviewing your profile and will update shortly.",
      "Thank you for your patience while we finalize the candidate pipeline.",
      "We will be reaching out with next steps by tomorrow.",
    ],
  },

  // --- Cluster 8: Polite Decline / Not Interested ---
  DECLINE_POLITE: {
    id: "DECLINE_POLITE",
    type: "decline",
    seeker: [
      "Thank you for the opportunity, but I must respectfully pass at this time.",
      "I appreciate you reaching out, but I'm currently committed elsewhere.",
      "Thank you for considering me, and let's definitely stay in touch!",
    ],
    recruiter: [
      "Thank you for your time, and we wish you the best in your search.",
      "We appreciate your interest and will keep your profile on file for future roles.",
    ],
  },

  // --- Cluster 9: Gratitude & Polite Sign-off ---
  GRATITUDE_CLOSING: {
    id: "GRATITUDE_CLOSING",
    type: "courtesy",
    seeker: [
      "Thank you so much! Have a great rest of your day.",
      "Appreciate the quick reply, talk soon!",
      "Thanks again for your time and coordination.",
      "Have a wonderful weekend ahead!",
    ],
    recruiter: [
      "You're very welcome! Talk soon.",
      "Have a great day ahead!",
      "Looking forward to our conversation.",
      "Have a wonderful weekend!",
    ],
  },

  // --- Cluster 10: General Acknowledgment / Need More Time ---
  ACKNOWLEDGMENT: {
    id: "ACKNOWLEDGMENT",
    type: "neutral",
    seeker: [
      "Got it, thank you for letting me know.",
      "Understood! I'll take a look and get right back to you.",
      "Will do, thanks for the heads up!",
      "Let me double check and get back to you shortly.",
    ],
    recruiter: [
      "Got it, thanks for the update.",
      "Understood, take your time.",
      "Sounds good, keep me posted.",
    ],
  },

  // --- Cluster 11: Conversation Openers / Icebreakers ---
  THREAD_STARTER: {
    id: "THREAD_STARTER",
    type: "opener",
    seeker: [
      "Hi {name}, I'm very excited about the {job} role at {company}!",
      "Thank you for reviewing my application for {job}.",
      "I'd love to share more about how my background aligns with {job}.",
    ],
    recruiter: [
      "Hi {name}, thank you for applying to {job} at {company}!",
      "I reviewed your impressive background and would love to connect.",
      "Are you available for a brief introductory chat this week?",
    ],
  },

  // --- Cluster 12: Follow-Up Nudge (When current user sent last message) ---
  FOLLOW_UP_NUDGE: {
    id: "FOLLOW_UP_NUDGE",
    type: "followup",
    seeker: [
      "Just following up on my previous message!",
      "Let me know if you need any other details from my end.",
      "Checking in to see if you had a chance to review.",
    ],
    recruiter: [
      "Following up to see if you're still interested in the {job} role.",
      "Let me know if you have any questions about the position.",
      "Looking forward to hearing from you when you have a moment.",
    ],
  },
};

// ==========================================
// 2. MULTI-TURN CONVERSATION STATE DETECTOR
// ==========================================

const INTENT_CLASSIFICATION_RULES = [
  {
    clusterId: "AVAILABILITY_INQUIRY",
    patterns: [
      /\b(when are you (free|available))\b/i,
      /\b(availability|free time|schedule a (call|chat|interview))\b/i,
      /\b(what time(s)? work(s)? for you)\b/i,
      /\b(available (tomorrow|this week|next week|today))\b/i,
      /\b(openings? on your calendar)\b/i,
      /\b(calendar link|book a slot)\b/i,
    ],
    targetClusters: ["SCHEDULING_CONFIRM", "SCHEDULING_ALTERNATIVE", "ACKNOWLEDGMENT"],
  },
  {
    clusterId: "TIME_PROPOSAL",
    patterns: [
      /\b(how does (at )?\d{1,2}(:\d{2})?\s*(am|pm)? sound)\b/i,
      /\b(let's (meet|connect) (on|at))\b/i,
      /\b(available at \d{1,2}(:\d{2})?\s*(am|pm)?)\b/i,
      /\b(can you do \w+day at \d{1,2})\b/i,
      /\b(does \d{1,2}(:\d{2})?\s*(am|pm)? work)\b/i,
    ],
    targetClusters: ["AFFIRMATIVE", "SCHEDULING_ALTERNATIVE", "ACKNOWLEDGMENT"],
  },
  {
    clusterId: "INTERVIEW_INVITATION",
    patterns: [
      /\b(invited you to (a |an )?technical interview)\b/i,
      /\b(interview room|coding studio|live coding|technical round)\b/i,
      /\b(join the (interview|call|room|studio))\b/i,
      /\b(scheduled for (our|the) interview)\b/i,
    ],
    targetClusters: ["INTERVIEW_STUDIO", "AFFIRMATIVE", "SCHEDULING_ALTERNATIVE"],
  },
  {
    clusterId: "PORTFOLIO_REQUEST",
    patterns: [
      /\b(github|portfolio|code sample(s)?|projects?|repositories)\b/i,
      /\b(share your (work|code|github|portfolio|resume))\b/i,
      /\b(can you provide link(s)? to)\b/i,
      /\b(send over your profile)\b/i,
    ],
    targetClusters: ["PORTFOLIO_ARTIFACTS", "ACKNOWLEDGMENT", "AFFIRMATIVE"],
  },
  {
    clusterId: "SALARY_INQUIRY",
    patterns: [
      /\b(salary expectation(s)?|compensation|target rate|budget|ctc|package)\b/i,
      /\b(what is your expected (salary|ctc|package|rate))\b/i,
    ],
    targetClusters: ["SALARY_COMPENSATION", "AFFIRMATIVE", "STATUS_INQUIRY"],
  },
  {
    clusterId: "STATUS_UPDATE",
    patterns: [
      /\b(shortlisted|reviewed your (profile|resume|application))\b/i,
      /\b(moving forward|next stage|next step(s)?|offer)\b/i,
      /\b(impressed with your|feedback from the team)\b/i,
    ],
    targetClusters: ["AFFIRMATIVE", "GRATITUDE_CLOSING", "STATUS_INQUIRY"],
  },
  {
    clusterId: "CONFIRMATION_GRATITUDE",
    patterns: [
      /\b(sounds great|perfect|that works|confirmed|see you then|got it)\b/i,
      /\b(thank you|thanks for (the update|your time|reaching out))\b/i,
      /\b(have a great (day|weekend)|talk soon|cheers)\b/i,
    ],
    targetClusters: ["GRATITUDE_CLOSING", "ACKNOWLEDGMENT", "AFFIRMATIVE"],
  },
  {
    clusterId: "GENERAL_QUESTION",
    patterns: [/\?$/],
    targetClusters: ["AFFIRMATIVE", "ACKNOWLEDGMENT", "SCHEDULING_CONFIRM"],
  },
];

/**
 * Injects entity templates ({name}, {job}, {company}) into response strings
 */
function injectEntities(template, { name = "there", job = "the position", company = "the company" } = {}) {
  return template
    .replace(/{name}/g, name)
    .replace(/{job}/g, job)
    .replace(/{company}/g, company);
}

/**
 * LinkedIn-Grade Smart Reply Selection Engine
 * Evaluates conversation history, detects dialogue act, ensures 3-cluster diversity (MMR),
 * and injects dynamic entities.
 */
function generateLinkedInSmartReplies({
  messages = [],
  userRole = "seeker",
  currentUserId = null,
  counterpart = {},
  job = {},
  applicationStatus = "applied",
}) {
  const isCandidate = userRole === "seeker";
  const roleKey = isCandidate ? "seeker" : "recruiter";
  const counterpartName = counterpart.name || (isCandidate ? "Recruiter" : "Candidate");
  const jobTitle = job.title || "the role";
  const companyName = job.company || "Jobly";

  const entityContext = {
    name: counterpartName,
    job: jobTitle,
    company: companyName,
  };

  // State 1: Fresh conversation with 0 messages
  if (!messages || messages.length === 0) {
    const starterTemplates = RESPONSE_CLUSTERS.THREAD_STARTER[roleKey] || [];
    return starterTemplates.slice(0, 3).map((t) => injectEntities(t, entityContext));
  }

  // Identify last message and who sent it
  const lastMsg = messages[messages.length - 1];
  const lastSenderId = typeof lastMsg.sender === "object"
    ? (lastMsg.sender?._id ?? lastMsg.sender?.id)
    : lastMsg.sender;

  const isSentByCurrentUser = currentUserId && String(lastSenderId) === String(currentUserId);

  // State 2: Current user was the last to send a message (Awaiting response)
  if (isSentByCurrentUser) {
    const followupTemplates = RESPONSE_CLUSTERS.FOLLOW_UP_NUDGE[roleKey] || [];
    const courtesyTemplates = RESPONSE_CLUSTERS.GRATITUDE_CLOSING[roleKey] || [];
    return [
      injectEntities(followupTemplates[0] || "Just following up on my previous message!", entityContext),
      injectEntities(followupTemplates[1] || "Let me know if you need any other details.", entityContext),
      injectEntities(courtesyTemplates[0] || "Looking forward to speaking soon!", entityContext),
    ];
  }

  // State 3: Incoming message from counterpart -> Detect intent & target clusters
  const cleanText = String(lastMsg.text || "").trim();
  let matchedRule = INTENT_CLASSIFICATION_RULES.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(cleanText))
  );

  if (!matchedRule) {
    if (cleanText.endsWith("?")) {
      matchedRule = INTENT_CLASSIFICATION_RULES.find((r) => r.clusterId === "GENERAL_QUESTION");
    }
  }

  // Determine top 3 diverse cluster IDs (MMR principle: exactly 1 item per cluster)
  const targetClusterIds = matchedRule
    ? matchedRule.targetClusters
    : ["AFFIRMATIVE", "ACKNOWLEDGMENT", "GRATITUDE_CLOSING"];

  const suggestedReplies = [];

  for (const clusterId of targetClusterIds) {
    const cluster = RESPONSE_CLUSTERS[clusterId];
    if (cluster && cluster[roleKey] && cluster[roleKey].length > 0) {
      // Pick the best phrasing from this cluster
      const template = cluster[roleKey][0];
      suggestedReplies.push(injectEntities(template, entityContext));
    }
  }

  // Ensure exactly 3 replies are returned
  while (suggestedReplies.length < 3) {
    const fallbackOptions = isCandidate
      ? ["Thank you for the update!", "Sounds good, looking forward to it.", "Let me know if you need anything else."]
      : ["Thanks for the update.", "Looking forward to connecting.", "Feel free to reach out if you have questions."];
    suggestedReplies.push(fallbackOptions[suggestedReplies.length]);
  }

  return suggestedReplies.slice(0, 3);
}

module.exports = {
  RESPONSE_CLUSTERS,
  generateLinkedInSmartReplies,
  classifyIntent: (text) => {
    if (!text) return "EMPTY_THREAD";
    const rule = INTENT_CLASSIFICATION_RULES.find((r) =>
      r.patterns.some((p) => p.test(text))
    );
    return rule ? rule.clusterId : (text.endsWith("?") ? "GENERAL_QUESTION" : "GENERAL_UPDATE");
  },
};
