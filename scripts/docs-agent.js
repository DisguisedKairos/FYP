const core = require('@actions/core');
const github = require('@actions/github');
const { OpenAI } = require('openai');

async function run() {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const openaiKey = process.env.OPENAI_API_KEY;
    const webhookUrl = process.env.CHATBOT_WEBHOOK_URL;

    if (!openaiKey) throw new Error("Missing OpenAI API Key");

    const octokit = github.getOctokit(githubToken);
    const openai = new OpenAI({ apiKey: openaiKey });
    const context = github.context;
    const { owner, repo } = context.repo;

    console.log("Fetching recent merged commits...");

    // 1. Gather Pipeline Evidence (Recent Commits)
    const { data: commits } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: 5 // Grab the last 5 commits for the release notes
    });

    const commitMessages = commits.map(c => `- ${c.commit.message}`).join('\n');

    console.log("Generating release notes via AI...");

    // 2. Instruct the LLM to write the documentation
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are an expert DevOps Technical Writer. Summarize the provided commit messages into a clean, professional Release Note. Group them into 'New Features', 'Security Fixes', and 'Bug Fixes'. Keep it concise and easy to read." 
        },
        { 
          role: "user", 
          content: `Here are the latest commits to the main branch:\n\n${commitMessages}` 
        }
      ]
    });

    const releaseNotes = aiResponse.choices[0].message.content;
    console.log("Release Notes Generated:\n", releaseNotes);

    // 3. Webhook Handoff to your Teammate's Chatbot
    if (webhookUrl) {
      console.log("Transmitting documentation to chatbot...");
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: "Documentation Agent",
          status: "Ready for Deployment",
          summary: releaseNotes,
          repository: repo
        })
      });

      if (!response.ok) {
        throw new Error(`Chatbot webhook failed with status ${response.status}`);
      }
      console.log("Successfully notified the team via Chatbot.");
    } else {
      console.log("No webhook URL configured. Skipping chatbot notification.");
    }

  } catch (error) {
    core.setFailed(`Documentation Agent failed: ${error.message}`);
  }
}

run();