const core = require('@actions/core');
const github = require('@actions/github');
const { OpenAI } = require('openai');

async function run() {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const openaiKey = process.env.OPENAI_API_KEY;
    
    if (!openaiKey) throw new Error("OpenAI API key is missing from secrets.");

    const octokit = github.getOctokit(githubToken);
    const openai = new OpenAI({ apiKey: openaiKey });
    const context = github.context;

    if (context.eventName !== 'pull_request') return;

    const prNumber = context.payload.pull_request.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    // 1. Fetch the raw code changes (diff)
    const { data: diffText } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' }
    });

    console.log("Analyzing PR diff with OpenAI...");

    // 2. Send the diff to OpenAI for QA analysis
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cost-effective model for text analysis
      messages: [
        { 
          role: "system", 
          content: "You are a strict QA lead reviewing a Pull Request. Analyze the provided code diff. Identify logic bugs, security risks, and missing tests. Provide a concise, structured review with bullet points. If the code looks good, state 'Ready for QA Testing'." 
        },
        { 
          role: "user", 
          content: `Here is the code diff to review:\n\n${diffText}` 
        }
      ]
    });

    const reviewComment = aiResponse.choices[0].message.content;

    // 3. Post the AI's review as a comment on the GitHub PR
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `### 🤖 QA Agent Review\n\n${reviewComment}`
    });

    console.log("Review posted successfully!");

  } catch (error) {
    core.setFailed(`MR Review Agent failed: ${error.message}`);
  }
}

run();