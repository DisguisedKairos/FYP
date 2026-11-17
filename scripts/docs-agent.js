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
    const shortSha = context.sha ? context.sha.slice(0, 7) : 'unknown';

    let commitList = [];
    const changedFilesSet = new Set();

    // Collect commits and modified filenames from push payload
    if (context.payload.commits && context.payload.commits.length > 0) {
      for (const c of context.payload.commits) {
        commitList.push(`- ${c.message} (by ${c.author.name || 'developer'})`);
        (c.added || []).forEach((f) => changedFilesSet.add(`added: ${f}`));
        (c.modified || []).forEach((f) => changedFilesSet.add(`modified: ${f}`));
        (c.removed || []).forEach((f) => changedFilesSet.add(`removed: ${f}`));
      }
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
        : `- Push to ${context.ref} (${shortSha})`;

    const changedFilesList = Array.from(changedFilesSet).slice(0, 30);
    const filesContext =
      changedFilesList.length > 0
        ? `\n\nModified Files:\n${changedFilesList.map((f) => `- ${f}`).join('\n')}`
        : '';

    console.log('Generating release documentation with OpenAI...');
    const openai = new OpenAI({ apiKey: openaiApiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a Release Documentation Agent for a wholesale banking and fraud detection platform. Summarize the git commits and modified files into structured Markdown release notes suitable for a changelog and chatbot knowledge base. Include three sections: 1) ### What Changed, 2) ### System & User Impact, and 3) ### Technical & Deployment Notes.',
        },
        {
          role: 'user',
          content: `Generate release notes for ${owner}/${repo} (commit ${shortSha}):\n\nCommits:\n${commitSummary}${filesContext}`,
        },
      ],
      temperature: 0.3,
    });

    const releaseNotes = completion.choices[0].message.content;
    console.log('Generated Release Notes:\n', releaseNotes);

    let webhookStatus = 'Skipped (No CHATBOT_WEBHOOK_URL configured)';

    if (webhookUrl) {
      console.log('Sending release notes payload to webhook...');
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'release_documentation_generated',
          repository: `${owner}/${repo}`,
          commit_sha: context.sha,
          short_sha: shortSha,
          timestamp: new Date().toISOString(),
          commits: commitList,
          changed_files: changedFilesList,
          release_notes: releaseNotes,
        }),
      });

      if (!response.ok) {
        throw new Error(`Webhook request failed with status ${response.status}`);
      }
      webhookStatus = `Delivered (HTTP ${response.status})`;
      console.log('Successfully delivered payload to webhook.');
    } else {
      console.log(webhookStatus);
    }

    // Render formatted Release Notes card directly on the GitHub Actions Summary page
    await core.summary
      .addHeading(`🚀 Release Documentation (${shortSha})`)
      .addRaw(releaseNotes)
      .addBreak()
      .addTable([
        [
          { data: 'Repository', header: true },
          { data: 'Commit', header: true },
          { data: 'Files Tracked', header: true },
          { data: 'Webhook Status', header: true },
        ],
        [
          `${owner}/${repo}`,
          `\`${shortSha}\``,
          `${changedFilesList.length}`,
          webhookStatus,
        ],
      ])
      .write();
  } catch (error) {
    core.setFailed(`Documentation Agent failed: ${error.message}`);
  }
}

run();