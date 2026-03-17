#!/usr/bin/env node
// Fetch GitHub repo data → data.json, then monitor for new events

const fs = require("fs");
const path = require("path");

const TOKEN = fs.readFileSync(path.join(__dirname, ".env.vars"), "utf-8").trim();
const REPO = (process.argv[2] || "rethread-studio/algorithmic-art-course")
  .replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
const TOP_N = 100;
const POLL_INTERVAL = 10000;

async function ghFetch(endpoint, extraHeaders = {}) {
  const url = endpoint.startsWith("http")
    ? endpoint
    : `https://api.github.com/${endpoint}`;
  const resp = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "Authorization": `Bearer ${TOKEN}`,
      "User-Agent": "fetch-data-script",
      ...extraHeaders,
    },
  });
  if (!resp.ok) {
    console.error(`  Failed: ${endpoint} → ${resp.status} ${resp.statusText}`);
    return [];
  }
  return resp.json();
}

async function ghFetchPaginated(endpoint, maxPages = 3) {
  let all = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = endpoint.includes("?") ? "&" : "?";
    const data = await ghFetch(`${endpoint}${sep}per_page=100&page=${page}`);
    if (!Array.isArray(data) || !data.length) break;
    all = all.concat(data);
    if (data.length < 100) break;
  }
  return all;
}

function normalizeAuthor(login, allAuthors) {
  const found = allAuthors.find(
    (a) => a.toLowerCase() === login.toLowerCase()
  );
  return found || login;
}

async function fetchHistoricalData() {
  console.log(`Fetching data from ${REPO}...`);

  console.log("  -> contributors...");
  const contributors = await ghFetch(
    `repos/${REPO}/contributors?per_page=100`
  );
  const contribArr = Array.isArray(contributors) ? contributors : [];
  const topContributors = contribArr.slice(0, TOP_N).map((c) => c.login);
  const allAuthors = contribArr.map((c) => c.login);
  console.log(
    `     ${contribArr.length} contributors, top ${TOP_N}: ${topContributors.join(", ")}`
  );

  console.log("  -> commits...");
  const allCommits = await ghFetchPaginated(`repos/${REPO}/commits`);
  console.log(`     ${allCommits.length} commits fetched`);

  console.log("  -> pull requests...");
  const allPRs = await ghFetchPaginated(`repos/${REPO}/pulls?state=all`);
  console.log(`     ${allPRs.length} pull requests fetched`);

  console.log("  -> issues...");
  const rawIssues = await ghFetch(
    `repos/${REPO}/issues?state=all&per_page=100`
  );
  const issues = (Array.isArray(rawIssues) ? rawIssues : []).filter(
    (i) => !i.pull_request
  );
  console.log(`     ${issues.length} issues fetched`);

  console.log("  -> stargazers...");
  const stars = await ghFetch(`repos/${REPO}/stargazers?per_page=100`, {
    Accept: "application/vnd.github.star+json",
  });
  const starsArr = Array.isArray(stars) ? stars : [];
  console.log(`     ${starsArr.length} stars fetched`);

  const events = [];

  // Group commits by same author within 1 hour → single PushEvent
  const commitsByAuthor = {};
  allCommits.forEach((c) => {
    const author = c.author
      ? c.author.login
      : c.commit.author.name || "unknown";
    const date = c.commit.author.date;
    const hour = date.substring(0, 13);
    const key = `${author}|${hour}`;
    if (!commitsByAuthor[key]) {
      commitsByAuthor[key] = {
        author,
        timestamp: date,
        commits: [],
        messages: [],
      };
    }
    commitsByAuthor[key].commits.push(c.sha);
    commitsByAuthor[key].messages.push(c.commit.message.split("\n")[0]);
  });

  Object.values(commitsByAuthor).forEach((group) => {
    events.push({
      id: `push-${group.commits[0].substring(0, 8)}`,
      type: "PushEvent",
      timestamp: group.timestamp,
      author: normalizeAuthor(group.author, allAuthors),
      data: {
        commits: group.commits.length,
        message: group.messages[0],
        additions:
          group.commits.length * 25 + Math.floor(Math.random() * 50),
        deletions: group.commits.length * 8 + Math.floor(Math.random() * 20),
      },
    });
  });

  allPRs.forEach((pr) => {
    const author = pr.user ? pr.user.login : "unknown";
    events.push({
      id: `pr-${pr.number}`,
      type: "PullRequestEvent",
      timestamp: pr.created_at,
      author: normalizeAuthor(author, allAuthors),
      data: {
        action: "opened",
        title: pr.title,
        number: pr.number,
        additions: 50 + Math.floor(Math.random() * 150),
        deletions: 10 + Math.floor(Math.random() * 50),
      },
    });
    if (pr.merged_at) {
      events.push({
        id: `merge-${pr.number}`,
        type: "MergeEvent",
        timestamp: pr.merged_at,
        author: normalizeAuthor(author, allAuthors),
        data: {
          sourceBranch: pr.head ? pr.head.ref : "feature",
          targetBranch: pr.base ? pr.base.ref : "main",
          commits: pr.commits || 1,
          title: pr.title,
        },
      });
    }
  });

  issues.forEach((issue) => {
    const author = issue.user ? issue.user.login : "unknown";
    events.push({
      id: `issue-${issue.number}`,
      type: "IssuesEvent",
      timestamp: issue.created_at,
      author: normalizeAuthor(author, allAuthors),
      data: {
        action: "opened",
        title: issue.title,
        number: issue.number,
        labels: (issue.labels || []).map((l) => l.name),
      },
    });
  });

  starsArr.forEach((star) => {
    const author = star.user ? star.user.login : "unknown";
    events.push({
      id: `star-${author}`,
      type: "WatchEvent",
      timestamp: star.starred_at,
      author: normalizeAuthor(author, allAuthors),
      data: { action: "starred" },
    });
  });

  events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const output = {
    meta: {
      repo: REPO,
      fetchedAt: new Date().toISOString(),
      contributors: topContributors,
      allAuthors: [...new Set(events.map((e) => e.author))],
      eventCount: events.length,
    },
    events,
  };

  fs.writeFileSync("data.json", JSON.stringify(output, null, 2));
  console.log(`\nDone! Generated data.json with ${events.length} events`);
  console.log(
    `  PushEvent: ${events.filter((e) => e.type === "PushEvent").length}`
  );
  console.log(
    `  PullRequestEvent: ${events.filter((e) => e.type === "PullRequestEvent").length}`
  );
  console.log(
    `  MergeEvent: ${events.filter((e) => e.type === "MergeEvent").length}`
  );
  console.log(
    `  IssuesEvent: ${events.filter((e) => e.type === "IssuesEvent").length}`
  );
  console.log(
    `  WatchEvent: ${events.filter((e) => e.type === "WatchEvent").length}`
  );
  console.log(`  Top contributors: ${topContributors.join(", ")}`);
  console.log(
    `  Total unique authors: ${output.meta.allAuthors.length}`
  );

  return output;
}

function transformLiveEvent(ev) {
  const author = ev.actor ? ev.actor.login : "unknown";
  const ts = ev.created_at;
  switch (ev.type) {
    case "PushEvent": {
      const commits = ev.payload.size || 1;
      return {
        id: `live-${ev.id}`, type: "PushEvent", author, timestamp: ts,
        data: { commits, additions: commits * 20, deletions: commits * 5 },
      };
    }
    case "PullRequestEvent": {
      const pr = ev.payload.pull_request || {};
      const merged = ev.payload.action === "closed" && pr.merged;
      if (merged) {
        return {
          id: `live-${ev.id}`, type: "MergeEvent", author, timestamp: ts,
          data: { additions: pr.additions || 50, deletions: pr.deletions || 10 },
        };
      }
      return {
        id: `live-${ev.id}`, type: "PullRequestEvent", author, timestamp: ts,
        data: { additions: pr.additions || 30, deletions: pr.deletions || 10, action: ev.payload.action },
      };
    }
    case "IssuesEvent":
      return {
        id: `live-${ev.id}`, type: "IssuesEvent", author, timestamp: ts,
        data: {
          action: ev.payload.action,
          labels: ((ev.payload.issue && ev.payload.issue.labels) || []).map((l) => l.name),
        },
      };
    case "WatchEvent":
      return { id: `live-${ev.id}`, type: "WatchEvent", author, timestamp: ts, data: {} };
    case "CreateEvent":
      return {
        id: `live-${ev.id}`, type: "PushEvent", author, timestamp: ts,
        data: { commits: 1, additions: 10, deletions: 0 },
      };
    case "IssueCommentEvent":
      return {
        id: `live-${ev.id}`, type: "IssuesEvent", author, timestamp: ts,
        data: { action: "comment", labels: [] },
      };
    case "ForkEvent":
      return { id: `live-${ev.id}`, type: "WatchEvent", author, timestamp: ts, data: {} };
    default:
      return null;
  }
}

async function monitor() {
  let etag = null;
  const seenIds = new Set();

  try {
    const existing = JSON.parse(fs.readFileSync("data.json", "utf-8"));
    existing.events.forEach((e) => seenIds.add(e.id));
  } catch (e) {}

  console.log(
    `\nMonitoring ${REPO} for new events every ${POLL_INTERVAL / 1000}s...`
  );
  console.log("Press Ctrl+C to stop.\n");

  async function poll() {
    try {
      const headers = {
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${TOKEN}`,
        "User-Agent": "fetch-data-script",
      };
      if (etag) headers["If-None-Match"] = etag;

      const resp = await fetch(
        `https://api.github.com/repos/${REPO}/events?per_page=100`,
        { headers }
      );

      const rl = resp.headers.get("X-RateLimit-Remaining");

      if (resp.status === 304) {
        process.stdout.write(
          `\r  [${new Date().toLocaleTimeString()}] No changes (RL: ${rl})     `
        );
        return;
      }
      if (!resp.ok) {
        console.log(
          `\n  [${new Date().toLocaleTimeString()}] HTTP ${resp.status} (RL: ${rl})`
        );
        return;
      }

      etag = resp.headers.get("ETag");
      const events = await resp.json();

      const newEvents = [];
      for (const ev of events) {
        const liveId = `live-${ev.id}`;
        if (seenIds.has(ev.id) || seenIds.has(liveId)) continue;
        seenIds.add(ev.id);
        seenIds.add(liveId);
        const transformed = transformLiveEvent(ev);
        if (transformed) newEvents.push(transformed);
      }

      if (newEvents.length > 0) {
        const data = JSON.parse(fs.readFileSync("data.json", "utf-8"));
        data.events.push(...newEvents);
        data.events.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
        );
        data.meta.eventCount = data.events.length;
        data.meta.allAuthors = [
          ...new Set(data.events.map((e) => e.author)),
        ];
        fs.writeFileSync("data.json", JSON.stringify(data, null, 2));
        console.log(
          `\n  [${new Date().toLocaleTimeString()}] +${newEvents.length} new events → total: ${data.events.length} (RL: ${rl})`
        );
        newEvents.forEach((e) =>
          console.log(`    ${e.type} by ${e.author}`)
        );
      } else {
        process.stdout.write(
          `\r  [${new Date().toLocaleTimeString()}] Polled, 0 new (RL: ${rl})        `
        );
      }
    } catch (err) {
      console.error(
        `\n  [${new Date().toLocaleTimeString()}] Error: ${err.message}`
      );
    }
  }

  await poll();
  setInterval(poll, POLL_INTERVAL);
}

async function main() {
  await fetchHistoricalData();
  await monitor();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
