require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./src/models/User");
const Job = require("./src/models/Job");
const Application = require("./src/models/Application");

const MOCK_RECRUITERS = [
  { name: "Sundar Pichai", email: "sundar@google.com", role: "recruiter" },
  { name: "Satya Nadella", email: "satya@microsoft.com", role: "recruiter" },
  { name: "Andy Jassy", email: "andy@amazon.com", role: "recruiter" }
];

const MOCK_SEEKERS = [
  { name: "John Doe", email: "john@example.com", role: "seeker", skills: ["React", "Node.js", "MongoDB"] },
  { name: "Jane Smith", email: "jane@example.com", role: "seeker", skills: ["Python", "Django", "SQL"] },
  { name: "Alice Johnson", email: "alice@example.com", role: "seeker", skills: ["Java", "Spring Boot", "AWS"] },
  { name: "Bob Brown", email: "bob@example.com", role: "seeker", skills: ["C++", "Algorithms", "System Design"] },
  { name: "Charlie Davis", email: "charlie@example.com", role: "seeker", skills: ["JavaScript", "TypeScript", "React"] },
  { name: "Diana Prince", email: "diana@example.com", role: "seeker", skills: ["Docker", "Kubernetes", "DevOps"] },
  { name: "Evan Wright", email: "evan@example.com", role: "seeker", skills: ["Machine Learning", "TensorFlow", "Python"] },
  { name: "Fiona Gallagher", email: "fiona@example.com", role: "seeker", skills: ["UI/UX", "Figma", "CSS"] },
  { name: "George Miller", email: "george@example.com", role: "seeker", skills: ["Go", "Microservices", "PostgreSQL"] },
  { name: "Hannah Abbott", email: "hannah@example.com", role: "seeker", skills: ["Data Analysis", "SQL", "Tableau"] }
];

const MOCK_JOBS = [
  { title: "Senior React Developer", company: "Google", description: "Looking for an expert React developer to join the Search team.", skills: ["React", "JavaScript", "TypeScript"], location: "Mountain View, CA", type: "Full-time" },
  { title: "Backend Node.js Engineer", company: "Google", description: "Build scalable APIs using Node.js and Express.", skills: ["Node.js", "Express", "MongoDB"], location: "Remote", type: "Full-time" },
  { title: "Frontend Software Engineer", company: "Microsoft", description: "Develop modern web applications using React and Redux.", skills: ["React", "Redux", "CSS"], location: "Seattle, WA", type: "Full-time" },
  { title: "Cloud Infrastructure Engineer", company: "Microsoft", description: "Design and maintain Azure infrastructure.", skills: ["Azure", "Docker", "Kubernetes"], location: "Remote", type: "Full-time" },
  { title: "Machine Learning Scientist", company: "Amazon", description: "Work on advanced recommendation algorithms.", skills: ["Python", "Machine Learning", "AWS"], location: "Seattle, WA", type: "Full-time" },
  { title: "Full Stack Developer", company: "Amazon", description: "Build end-to-end solutions using MERN stack.", skills: ["MongoDB", "Express", "React", "Node.js"], location: "Remote", type: "Full-time" },
  { title: "DevOps Engineer", company: "Google", description: "Streamline CI/CD pipelines and deployment processes.", skills: ["DevOps", "CI/CD", "AWS", "Docker"], location: "New York, NY", type: "Contract" },
  { title: "Data Engineer", company: "Microsoft", description: "Build data pipelines and optimize data storage.", skills: ["SQL", "Python", "Spark"], location: "Remote", type: "Full-time" },
  { title: "Product Designer", company: "Amazon", description: "Design intuitive user interfaces for AWS products.", skills: ["Figma", "UI/UX", "Prototyping"], location: "San Francisco, CA", type: "Full-time" },
  { title: "Cybersecurity Analyst", company: "Google", description: "Monitor and protect Google's internal networks.", skills: ["Security", "Networking", "Python"], location: "Austin, TX", type: "Full-time" }
];

async function seed() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected successfully!");

    console.log("Creating Recruiters...");
    const recruiters = [];
    for (const r of MOCK_RECRUITERS) {
      const user = await User.findOneAndUpdate({ email: r.email }, { ...r, password: "password123" }, { upsert: true, new: true });
      recruiters.push(user);
    }

    console.log("Creating Seekers...");
    const seekers = [];
    for (const s of MOCK_SEEKERS) {
      const user = await User.findOneAndUpdate({ email: s.email }, { ...s, password: "password123" }, { upsert: true, new: true });
      seekers.push(user);
    }

    console.log("Creating Jobs...");
    const jobs = [];
    for (let i = 0; i < MOCK_JOBS.length; i++) {
      const jobData = MOCK_JOBS[i];
      // Assign jobs to recruiters in a round-robin fashion
      const recruiter = recruiters[i % recruiters.length];
      const job = await Job.findOneAndUpdate(
        { title: jobData.title, company: jobData.company },
        { ...jobData, recruiter: recruiter._id },
        { upsert: true, new: true }
      );
      jobs.push(job);
    }

    console.log("Creating Fake Applications...");
    // Let's make every seeker apply to 3 random jobs
    for (const seeker of seekers) {
      const shuffledJobs = jobs.sort(() => 0.5 - Math.random()).slice(0, 3);
      for (const job of shuffledJobs) {
        
        const score = Math.floor(Math.random() * (95 - 40 + 1) + 40); // Random score between 40 and 95
        
        await Application.findOneAndUpdate(
          { job: job._id, seeker: seeker._id },
          {
            job: job._id,
            seeker: seeker._id,
            recruiter: job.recruiter,
            status: score > 75 ? "shortlisted" : "applied",
            atsScore: score,
            atsBreakdown: {
              skillMatch: score,
              experienceRelevance: score - 5,
              educationFit: score + 5,
              projectsAndAchievements: score,
              keywordOptimization: score - 2,
              overallPresentation: score + 2
            },
            atsTips: ["Consider adding more metrics to your projects.", "Highlight your leadership experience."]
          },
          { upsert: true }
        );
      }
    }

    // Assign a bunch of applications to the user's specific recruiter account if they created one
    // Look for the user's recruiter account
    const myRecruiter = await User.findOne({ email: "iit2024150@iiita.ac.in", role: "recruiter" });
    if (myRecruiter) {
        console.log("Found your recruiter account! Generating jobs and applications for you...");
        for(let i=0; i<5; i++) {
            const jobData = MOCK_JOBS[i];
            const job = await Job.findOneAndUpdate(
                { title: `Your ${jobData.title}`, company: "Your Company" },
                { ...jobData, title: `Your ${jobData.title}`, company: "Your Company", recruiter: myRecruiter._id },
                { upsert: true, new: true }
              );
            // Have all 10 fake seekers apply to your job
            for (const seeker of seekers) {
                const score = Math.floor(Math.random() * (98 - 60 + 1) + 60); // Random score between 60 and 98
                await Application.findOneAndUpdate(
                  { job: job._id, seeker: seeker._id },
                  {
                    job: job._id,
                    seeker: seeker._id,
                    recruiter: myRecruiter._id,
                    status: score > 85 ? "shortlisted" : "applied",
                    atsScore: score,
                    atsBreakdown: {
                      skillMatch: score,
                      experienceRelevance: score - 5,
                      educationFit: score + 5,
                      projectsAndAchievements: score,
                      keywordOptimization: score - 2,
                      overallPresentation: score + 2
                    },
                    atsTips: ["Great resume!", "Consider quantifying your impact."]
                  },
                  { upsert: true }
                );
            }
        }
    }

    console.log("Database seeded successfully with lots of data!");
    process.exit(0);
  } catch (error) {
    console.error("Error seeding database:", error);
    process.exit(1);
  }
}

seed();
