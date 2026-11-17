const core = require('@actions/core');
const github = require('@actions/github');
const { OpenAI } = require('openai');

const COMMENT_MARKER = '<!-- ai-mr-review-agent -->';

// Ignore lockfiles, binaries, and static assets so tokens are spent on real code
const IGNORED_PATTERNS = [
  /^package-lock\.json$/,
  /\.lock$/,
  /\.(svg|png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot)$/i,
  /\.min\.(js|css)$/i,
];

// Highlight critical project paths for deeper security/logic inspection
const SENSITIVE_PATTERNS = [
  /^banking\/(auth|security|totp|ledger|permissions)\.js$/,
  /^database\/migrations\//,
  /^fraud_service\//,
  /^\.github\/workflows\//,
];

function isIgnored(filename) {
  return IGNORED_PATTERNS.some((regex) => regex.test(filename));
}

function isSensitive(filename) {
  return SENSITIVE_PATTERNS.some((regex) => regex.test(filename));
}

async function run() {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (!openaiApiKey) throw new Error('Missing OpenAI API Key');
    if (!githubToken) throw new Error('Missing GITHUB_TOKEN');

    const octokit = github.getOctokit(githubToken);
    const context = github.context;

    if (!context.payload.pull_request) {
      console.log('Not a pull request event. Skipping MR review.');
      return;
    }

    const { owner, repo } = context.repo;
    const pull_number = context.payload.pull_request.number;
    const headSha = context.payload.pull_request.head.sha.slice(0, 7);

    console.log(`Fetching changed files for PR #${pull_number}...`);
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number,
    });

    const skippedFiles = [];
    const sensitiveFilesTouched = [];
    const reviewableFiles = [];

    for (const file of files) {
      if (isIgnored(file.filename) || !file.patch) {
        skippedFiles.push(file.filename);
        continue;
      }
      if (isSensitive(file.filename)) {
        sensitiveFilesTouched.push(file.filename);
      }
      reviewableFiles.push(file);
    }

    if (reviewableFiles.length === 0) {
      console.log('No reviewable code patches found (only lockfiles/assets/binaries).');
      return;
    }

    const diffSummary = reviewableFiles
      .map(
        (file) =>
          `### File: ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})\n\`\`\`diff\n${file.patch.slice(0, 3000)}\n\`\`\``
      )
      .join('\n\n');

    const sensitiveContext =
      sensitiveFilesTouched.length > 0
        ? `\n⚠️ CRITICAL PATHS MODIFIED: ${sensitiveFilesTouched.join(', ')}. Pay extra attention to authentication, SQL migration safety, permissions, and fraud service integrity.`
        : '';

    console.log('Analyzing PR diff with OpenAI...');
    const openai = new OpenAI({ apiKey: openaiApiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an automated QA & Security Merge Request Review Agent for a wholesale banking & fraud detection platform.
Analyze the git diff and respond in clean Markdown using this exact structure:
1. First line MUST be a risk badge: "**Overall Risk:** 🟢 LOW RISK", "**Overall Risk:** 🟡 MEDIUM RISK", or "**Overall Risk:** 🔴 HIGH RISK" followed by a 1-sentence justification.
2. **Summary of Changes**: Concise bullet points of what changed.
3. **Logic & Bug Risks**: Specific edge cases, null-safety, or async/database handling issues (or state "None identified").
4. **Security & Compliance Concerns**: Check for hardcoded secrets, SQL injection, auth bypass, or unsafe input handling (or state "None identified").
5. **QA Testing Recommendations**: Concrete verification steps or test files to run.${sensitiveContext}`,
        },
        {
          role: 'user',
          content: `Review Pull Request #${pull_number} (commit ${headSha}):\n\n${diffSummary}`,
        },
      ],
      temperature: 0.2,
    });

    const reviewBody = completion.choices[0].message.content;

    const metaFooter = [
      `---`,
      `🔍 **Reviewed Files:** ${reviewableFiles.length} | ⏭️ **Skipped (Lockfiles/Assets):** ${skippedFiles.length}${
        sensitiveFilesTouched.length > 0
          ? ` | 🛡️ **Sensitive Paths:** \`${sensitiveFilesTouched.join('`, `')}\``
          : ''
      }`,
      `*Automated QA & MR Review Agent • Synced with commit \`${headSha}\`*`,
    ].join('\n');

    const finalComment = `${COMMENT_MARKER}\n## 🤖 Automated QA & MR Review\n\n${reviewBody}\n\n${metaFooter}`;

    // Check if our bot already posted a review comment on this PR
    const { data: existingComments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: pull_number,
    });

    const previousComment = existingComments.find(
      (c) => c.body && c.body.includes(COMMENT_MARKER)
    );

    if (previousComment) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: previousComment.id,
        body: finalComment,
      });
      console.log(`Updated existing MR review comment (#${previousComment.id}) for commit ${headSha}.`);
    } else {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body: finalComment,
      });
      console.log(`Created new MR review comment on PR #${pull_number}.`);
    }

    // Also write to the GitHub Actions Workflow Summary UI
    await core.summary
      .addHeading(`🤖 MR Review — PR #${pull_number} (${headSha})`)
      .addRaw(reviewBody)
      .addBreak()
      .addRaw(metaFooter)
      .write();
  } catch (error) {
    core.setFailed(`MR Review Agent failed: ${error.message}`);
  }
}

run();