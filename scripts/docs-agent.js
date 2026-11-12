const core = require('@actions/core');
const github = require('@actions/github');
const { OpenAI } = require('openai');

async function run() {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const webhookUrl = process.env.CHATBOT_WEBHOOK_URL;

    if (!openaiApiKey) {
      throw new Error('Missing OpenAI API Key');
    }

    const context = github.context;
    const { owner, repo } = context.repo;

    // Collect recent commits from the push payload (or fallback to API)
    let commitList = [];
    if (context.payload.commits && context.payload.commits.length > 0) {
      commitList = context.payload.commits.map(
        (c) => `- ${c.message} (by ${c.author.name || 'developer'})`
      );
    } else if (githubToken) {
      const octokit = github.getOctokit(githubToken);
      const { data: commits } = await octokit.rest.repos.listCommits({
        owner,
        repo,
        per_page: 5,
      });
      commitList = commits.map(
        (c) => `- ${c.commit.message} (by ${c.commit.author.name})`
      );
    }

    const commitSummary =
      commitList.length > 0
        ? commitList.join('\n')
        : `- Push to ${context.ref} (${context.sha})`;

    console.log('Generating release documentation with OpenAI...');
    const openai = new OpenAI({ apiKey: openaiApiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a Release Documentation Agent. Summarize the provided git commits into clean, structured release notes suitable for a project changelog and chatbot knowledge base. Include: What Changed, Impact, and Technical Notes.',
        },
        {
          role: 'user',
          content: `Generate release notes for repository ${owner}/${repo} from these recent commits:\n\n${commitSummary}`,
        },
      ],
      temperature: 0.3,
    });

    const releaseNotes = completion.choices[0].message.content;
    console.log('Generated Release Notes:\n', releaseNotes);

    if (webhookUrl) {
      console.log('Sending release notes payload to webhook...');
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'release_documentation_generated',
          repository: `${owner}/${repo}`,
          commit_sha: context.sha,
          timestamp: new Date().toISOString(),
          commits: commitList,
          release_notes: releaseNotes,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Webhook request failed with status ${response.status}`
        );
      }
      console.log('Successfully delivered payload to webhook.');
    } else {
      console.log(
        'No CHATBOT_WEBHOOK_URL secret configured. Skipping webhook transmission.'
      );
    }
  } catch (error) {
    core.setFailed(`Documentation Agent failed: ${error.message}`);
  }
}

run();