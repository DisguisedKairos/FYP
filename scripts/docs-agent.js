const core = require('@actions/core');
const github = require('@actions/github');
const { OpenAI } = require('openai');

const FRONTEND_PATTERNS = [
  /^public\//,
  /^views\//,
];

const BACKEND_PATTERNS = [
  /^banking\//,
  /^fraud_service\//,
  /^database\//,
  /^deploy\//,
  /^scripts\//,
  /^(app|application)\.js$/,
  /^main\.py$/,
  /^neon\.ts$/,
];

function matchesAny(filepath, patterns) {
  const cleanPath = filepath.replace(/^(added|modified|removed):\s*/, '');
  return patterns.some((regex) => regex.test(cleanPath));
}

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
    const rawChangedFilesSet = new Set();
    const taggedChangedFilesSet = new Set();

    // Collect commits and modified/added/removed filenames from push payload
    if (context.payload.commits && context.payload.commits.length > 0) {
      for (const c of context.payload.commits) {
        commitList.push(`- ${c.message} (by ${c.author.name || 'developer'})`);
        (c.added || []).forEach((f) => {
          rawChangedFilesSet.add(f);
          taggedChangedFilesSet.add(`added: ${f}`);
        });
        (c.modified || []).forEach((f) => {
          rawChangedFilesSet.add(f);
          taggedChangedFilesSet.add(`modified: ${f}`);
        });
        (c.removed || []).forEach((f) => {
          rawChangedFilesSet.add(f);
          taggedChangedFilesSet.add(`removed: ${f}`);
        });
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

    const allChangedFiles = Array.from(rawChangedFilesSet);
    const frontendFiles = allChangedFiles.filter((f) => matchesAny(f, FRONTEND_PATTERNS));
    const backendFiles = allChangedFiles.filter((f) => matchesAny(f, BACKEND_PATTERNS));
    const changedFilesList = Array.from(taggedChangedFilesSet).slice(0, 30);

    const filesContext =
      changedFilesList.length > 0
        ? `\n\nModified Files:\n${changedFilesList.map((f) => `- ${f}`).join('\n')}`
        : '';

    const frontendContext =
      frontendFiles.length > 0
        ? `\n\nFrontend Files Touched (UI, client scripts, views):\n${frontendFiles.map((f) => `- ${f}`).join('\n')}`
        : '\n\nFrontend Files Touched: None in this push.';

    const backendContext =
      backendFiles.length > 0
        ? `\n\nBackend Files Touched (APIs, banking/fraud services, DB, deploy, scripts):\n${backendFiles.map((f) => `- ${f}`).join('\n')}`
        : '\n\nBackend Files Touched: None in this push.';

    console.log('Generating release documentation with OpenAI...');
    const openai = new OpenAI({ apiKey: openaiApiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a Release Documentation Agent for a wholesale banking and fraud detection platform. Summarize git commits and changed files into clear Markdown release notes separated cleanly into frontend and backend sections. Include four sections in this exact order: 1) ### Frontend Changes (summarize UI, views, and frontend agent/assistant files touched, or state "No frontend files modified in this push"), 2) ### Backend Changes (summarize server logic, banking/fraud modules, database migrations, deployment, or scripts touched, or state "No backend files modified in this push"), 3) ### System & User Impact, and 4) ### Technical & Deployment Notes.',
        },
        {
          role: 'user',
          content: `Generate release notes for ${owner}/${repo} (commit ${shortSha}):\n\nCommits:\n${commitSummary}${filesContext}${frontendContext}${backendContext}`,
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
          frontend_files: frontendFiles,
          backend_files: backendFiles,
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

    const frontendSummaryLabel =
      frontendFiles.length > 0
        ? frontendFiles.map((f) => `\`${f}\``).join(', ')
        : 'None';

    const backendSummaryLabel =
      backendFiles.length > 0
        ? backendFiles.map((f) => `\`${f}\``).join(', ')
        : 'None';

    await core.summary
      .addHeading(`🚀 Release Documentation (${shortSha})`)
      .addRaw(releaseNotes)
      .addBreak()
      .addTable([
        [
          { data: 'Repository', header: true },
          { data: 'Commit', header: true },
          { data: 'Frontend Files', header: true },
          { data: 'Backend Files', header: true },
          { data: 'Webhook Status', header: true },
        ],
        [
          `${owner}/${repo}`,
          `\`${shortSha}\``,
          frontendSummaryLabel,
          backendSummaryLabel,
          webhookStatus,
        ],
      ])
      .write();
  } catch (error) {
    core.setFailed(`Documentation Agent failed: ${error.message}`);
  }
}

run();