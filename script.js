/* ============================= state ============================= */
let paper = []; // normalized questions
let durationSec = 0; // total test seconds
let remaining = 0;
let cur = 0; // current question index
let answers = []; // selected option index or null
let visited = []; // bool
let marked = []; // bool
let timeSpent = []; // seconds (float) per question
let enteredAt = null; // timestamp when current question was entered
let mainTimer = null,
  qTimerTick = null;
let testStartedAt = null,
  testEndedAt = null;
let isPaused = false;
let activeTestId = null; // ID of current test in localStorage (if saved)

const STORAGE_KEY = "mock_hall_saved_tests";
const $ = (id) => document.getElementById(id);

/* ============================= storage helpers ============================= */
function getSavedTests() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function persistSavedTests(tests) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tests));
  renderSavedDashboard();
}

function saveCurrentPaperToStorage(customName, progressState = null) {
  if (!paper.length) return null;
  const tests = getSavedTests();
  const title = (customName || $("testTitle").textContent || "Mock Test").trim();
  const id = activeTestId || "test_" + Date.now();

  const testRecord = {
    id,
    title,
    durationSec: durationSec || (+Math.max(1, +$("durationInput").value || paper.length) * 60),
    paper,
    createdAt: new Date().toLocaleDateString(),
    progress: progressState
  };

  const existingIdx = tests.findIndex((t) => t.id === id);
  if (existingIdx !== -1) {
    tests[existingIdx] = { ...tests[existingIdx], ...testRecord };
  } else {
    tests.unshift(testRecord);
  }

  activeTestId = id;
  persistSavedTests(tests);
  return id;
}

function deleteSavedTest(id) {
  const tests = getSavedTests().filter((t) => t.id !== id);
  if (activeTestId === id) activeTestId = null;
  persistSavedTests(tests);
}

function renderSavedDashboard() {
  const list = $("savedTestsList");
  const tests = getSavedTests();
  $("savedCountTag").textContent = tests.length + " saved";

  if (!tests.length) {
    list.innerHTML = '<div class="saved-empty">No tests saved yet. Upload a JSON paper to save it.</div>';
    return;
  }

  list.innerHTML = "";
  tests.forEach((t) => {
    const item = document.createElement("div");
    item.className = "saved-item";
    const hasProgress = !!t.progress && t.progress.remaining > 0;
    const progressText = hasProgress
      ? ` • <span style="color:var(--warn);font-weight:600;">In Progress (${fmtClock(t.progress.remaining)} left)</span>`
      : "";

    item.innerHTML = `
      <div class="saved-item-info">
        <span class="saved-item-title">${esc(t.title)}</span>
        <span class="saved-item-meta">${t.paper.length} questions • ${Math.round(t.durationSec / 60)} min${progressText}</span>
      </div>
      <div class="saved-item-actions">
        ${hasProgress ? `<button class="btn primary resume-btn" style="padding:6px 12px;font-size:12px;">Resume</button>` : ""}
        <button class="btn start-btn" style="padding:6px 12px;font-size:12px;">${hasProgress ? "Restart" : "Start"}</button>
        <button class="btn ghost del-btn" style="padding:6px 10px;font-size:12px;" title="Delete">✕</button>
      </div>
    `;

    if (hasProgress) {
      item.querySelector(".resume-btn").addEventListener("click", () => resumeFromDashboard(t));
    }
    item.querySelector(".start-btn").addEventListener("click", () => startFromDashboard(t));
    item.querySelector(".del-btn").addEventListener("click", () => {
      if (confirm(`Delete "${t.title}"?`)) deleteSavedTest(t.id);
    });

    list.appendChild(item);
  });
}

/* ============================= helpers ============================= */
function esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = sec % 60;
  return (
    (h ? String(h).padStart(2, "0") + ":" : "") +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0")
  );
}
function fmtDur(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60),
    s = sec % 60;
  return m ? m + "m " + s + "s" : s + "s";
}
function show(screen) {
  document
    .querySelectorAll(".screen")
    .forEach((x) => x.classList.remove("active"));
  $(screen).classList.add("active");
  window.scrollTo(0, 0);
  if (screen === "setup") renderSavedDashboard();
}

/* ============================= parsing ============================= */
function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function normalizePaper(raw) {
  let arr = raw;
  if (!Array.isArray(arr) && arr && typeof arr === "object") {
    arr = pick(arr, ["questions", "data", "paper", "items"]);
  }
  if (!Array.isArray(arr) || !arr.length)
    throw new Error('Expected a JSON array of questions (or an object with a "questions" array).');

  return arr.map((q, i) => {
    const where = "Question at position " + (i + 1);
    if (typeof q !== "object" || q === null) throw new Error(where + " is not an object.");
    const text = pick(q, ["question", "questionText", "question_text", "text", "q"]);
    if (!text) throw new Error(where + ': missing "question" text.');
    let options = pick(q, ["options", "choices", "opts"]);
    if (!Array.isArray(options) || options.length < 2)
      throw new Error(where + ': "options" must be an array with at least 2 entries.');
    options = options.map((o) =>
      typeof o === "object" && o !== null
        ? String(pick(o, ["text", "option", "value", "label"]) ?? JSON.stringify(o))
        : String(o)
    );

    const rawAns = pick(q, [
      "correctAnswer",
      "correct_answer",
      "answer",
      "correct",
      "ans",
      "correctOption",
      "correct_option",
    ]);
    if (rawAns === undefined) throw new Error(where + ': missing "correctAnswer".');
    const ci = resolveAnswer(rawAns, options);
    if (ci === -1)
      throw new Error(
        where + ': correctAnswer "' + rawAns + '" does not match any option.'
      );

    return {
      num: pick(q, ["questionNumber", "question_number", "qno", "qNo", "sno", "number", "id"]) ?? i + 1,
      question: String(text),
      askedIn: String(pick(q, ["askedIn", "asked_in", "exam", "source", "paper"]) ?? "—"),
      options,
      correct: ci,
    };
  });
}

function resolveAnswer(ans, options) {
  const norm = (s) => String(s).trim().toLowerCase();
  const byText = options.findIndex((o) => norm(o) === norm(ans));
  if (byText !== -1) return byText;
  const m = String(ans).trim().match(/^\(?([A-Za-z])\)?$/);
  if (m) {
    const idx = m[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return idx;
  }
  const n = Number(ans);
  if (Number.isInteger(n)) {
    if (n >= 1 && n <= options.length) return n - 1;
    if (n === 0) return 0;
  }
  return -1;
}

/* ============================= setup screen ============================= */
const SAMPLE = [
  { questionNumber: 1, askedIn: "SSC CGL 2025 (Tier I)", question: "If the ratio of two numbers is 3 : 5 and their HCF is 4, what is their LCM?", options: ["15", "60", "64", "80"], correctAnswer: "60" },
  { questionNumber: 2, askedIn: "SSC CGL 2024", question: "Choose the word most nearly OPPOSITE in meaning to: FRUGAL", options: ["Thrifty", "Extravagant", "Careful", "Miserly"], correctAnswer: "B" },
  { questionNumber: 3, askedIn: "SSC CHSL 2025", question: "Who among the following was the first woman to become a judge of the Supreme Court of India?", options: ["Leila Seth", "Anna Chandy", "Fathima Beevi", "Ruma Pal"], correctAnswer: "Fathima Beevi" },
  { questionNumber: 4, askedIn: "SSC CGL 2025 (Tier I)", question: "A train 240 m long crosses a pole in 12 seconds. What is its speed in km/h?", options: ["60", "66", "72", "80"], correctAnswer: 3 },
  { questionNumber: 5, askedIn: "SSC MTS 2024", question: "In a certain code, TEACHER is written as VGCEJGT. How is STUDENT written in that code?", options: ["UVWFGPV", "UVWFGPU", "UWVFGPV", "UVWEGPV"], correctAnswer: "UVWFGPV" },
  { questionNumber: 6, askedIn: "SSC CGL 2023", question: "The Fundamental Duties were added to the Constitution of India by which Amendment?", options: ["24th Amendment", "42nd Amendment", "44th Amendment", "52nd Amendment"], correctAnswer: "42nd Amendment" },
  { questionNumber: 7, askedIn: "SSC CPO 2025", question: "The average of 5 consecutive odd numbers is 27. What is the largest of these numbers?", options: ["29", "31", "33", "35"], correctAnswer: "31" },
  { questionNumber: 8, askedIn: "SSC CGL 2025 (Tier I)", question: "Select the correctly spelt word:", options: ["Occassion", "Ocassion", "Occasion", "Occasionn"], correctAnswer: "Occasion" }
];

function tryLoadFromTextarea(fromUpload = false, fileName = "") {
  const t = $("jsonInput").value.trim();
  const status = $("loadStatus");
  if (!t) {
    status.className = "";
    status.style.display = "none";
    paper = [];
    $("startBtn").disabled = true;
    $("savePaperBtn").disabled = true;
    return;
  }
  try {
    paper = normalizePaper(JSON.parse(t));
    status.className = "ok";
    status.textContent = "✓ Loaded " + paper.length + " questions. Suggested time: " + paper.length + " min.";
    if (!(+$("durationInput").value > 0)) $("durationInput").value = paper.length;
    $("startBtn").disabled = false;
    $("savePaperBtn").disabled = false;

    // Prompt to save when a file upload occurs
    if (fromUpload) {
      setTimeout(() => {
        if (confirm("Would you like to save this test to your library for future use?")) {
          const title = prompt("Enter a title for this test:", fileName.replace(/\.json$/i, "") || "Mock Test");
          if (title) {
            saveCurrentPaperToStorage(title);
            alert("✓ Test saved to library!");
          }
        }
      }, 100);
    }
  } catch (e) {
    paper = [];
    $("startBtn").disabled = true;
    $("savePaperBtn").disabled = true;
    status.className = "err";
    status.textContent = "✗ " + (e instanceof SyntaxError ? "Invalid JSON — " + e.message : e.message);
  }
}

$("jsonInput").addEventListener("input", debounce(() => tryLoadFromTextarea(false), 350));
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

$("sampleBtn").addEventListener("click", () => {
  activeTestId = null;
  $("jsonInput").value = JSON.stringify(SAMPLE, null, 2);
  tryLoadFromTextarea(false);
});

$("savePaperBtn").addEventListener("click", () => {
  if (!paper.length) return;
  const title = prompt("Enter test title to save:", "Mock Test (" + paper.length + " Qs)");
  if (title) {
    saveCurrentPaperToStorage(title);
    alert("✓ Test paper saved to library!");
  }
});

$("fileInput").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    activeTestId = null;
    $("jsonInput").value = r.result;
    tryLoadFromTextarea(true, f.name);
  };
  r.onerror = () => {
    const s = $("loadStatus");
    s.className = "err";
    s.textContent = "✗ Could not read the file.";
  };
  r.readAsText(f);
  e.target.value = "";
});

$("startBtn").addEventListener("click", () => {
  startTest();
});

/* ============================= test flow ============================= */
function startFromDashboard(savedRecord) {
  activeTestId = savedRecord.id;
  paper = savedRecord.paper;
  durationSec = savedRecord.durationSec;
  $("durationInput").value = Math.round(durationSec / 60);
  startTest(false);
}

function resumeFromDashboard(savedRecord) {
  activeTestId = savedRecord.id;
  paper = savedRecord.paper;
  durationSec = savedRecord.durationSec;
  const p = savedRecord.progress;
  remaining = p.remaining;
  answers = [...p.answers];
  visited = [...p.visited];
  marked = [...p.marked];
  timeSpent = [...p.timeSpent];
  cur = p.cur;
  testStartedAt = p.testStartedAt;

  $("testTitle").textContent = savedRecord.title || ("Mock Test · " + paper.length + " questions");
  buildPalette();
  show("test");
  isPaused = false;
  $("pauseModal").classList.remove("active");
  goTo(cur, true);

  clearInterval(mainTimer);
  mainTimer = setInterval(tickClock, 1000);
  renderClock();
}

function startTest(resetId = true) {
  if (resetId && !activeTestId) activeTestId = null;
  const mins = Math.max(1, Math.min(600, +$("durationInput").value || paper.length));
  durationSec = mins * 60;
  remaining = durationSec;
  answers = paper.map(() => null);
  visited = paper.map(() => false);
  marked = paper.map(() => false);
  timeSpent = paper.map(() => 0);
  cur = 0;
  testStartedAt = Date.now();
  testEndedAt = null;
  isPaused = false;

  const currentTest = getSavedTests().find((t) => t.id === activeTestId);
  $("testTitle").textContent = (currentTest ? currentTest.title : "Mock Test") + " · " + paper.length + " Qs";
  buildPalette();
  show("test");
  $("pauseModal").classList.remove("active");
  goTo(0, true);

  clearInterval(mainTimer);
  mainTimer = setInterval(tickClock, 1000);
  renderClock();
}

function tickClock() {
  if (isPaused) return;
  remaining--;
  renderClock();
  if (remaining <= 0) finishTest(true);
}

function renderClock() {
  const c = $("clock");
  c.textContent = fmtClock(remaining);
  c.classList.toggle("warn", remaining <= durationSec * 0.25 && remaining > 60);
  c.classList.toggle("danger", remaining <= 60);
}

function commitTime() {
  if (enteredAt !== null && cur >= 0 && cur < paper.length && !isPaused) {
    timeSpent[cur] += (Date.now() - enteredAt) / 1000;
  }
  enteredAt = null;
}

function goTo(i, first = false) {
  if (!first) commitTime();
  cur = i;
  visited[cur] = true;
  enteredAt = Date.now();
  renderQuestion();
  renderPalette();
  clearInterval(qTimerTick);
  qTimerTick = setInterval(renderQTimer, 500);
  renderQTimer();
}

function renderQTimer() {
  if (isPaused) return;
  const live = timeSpent[cur] + (enteredAt ? (Date.now() - enteredAt) / 1000 : 0);
  const m = Math.floor(live / 60),
    s = Math.floor(live % 60);
  $("qTimer").textContent = m + ":" + String(s).padStart(2, "0");
}

function renderQuestion() {
  const q = paper[cur];
  $("testProgress").textContent = "QUESTION " + (cur + 1) + " / " + paper.length;
  $("qNumLabel").textContent = q.num;
  $("askedInTag").textContent = q.askedIn;
  $("qText").textContent = q.question;

  const list = $("optList");
  list.innerHTML = "";
  q.options.forEach((o, oi) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt" + (answers[cur] === oi ? " selected" : "");
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", answers[cur] === oi ? "true" : "false");
    b.innerHTML =
      '<span class="bubble">' +
      String.fromCharCode(65 + oi) +
      '</span><span class="otext">' +
      esc(o) +
      "</span>";
    b.addEventListener("click", () => {
      if (isPaused) return;
      answers[cur] = answers[cur] === oi ? null : oi;
      renderQuestion();
      renderPalette();
    });
    list.appendChild(b);
  });

  $("prevBtn").disabled = cur === 0;
  $("nextBtn").textContent = cur === paper.length - 1 ? "Save (last question)" : "Save & next →";
  $("markBtn").textContent = marked[cur] ? "Unmark review" : "Mark for review";
}

function buildPalette() {
  const g = $("pgrid");
  g.innerHTML = "";
  paper.forEach((q, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pbtn";
    b.textContent = i + 1;
    b.setAttribute("aria-label", "Go to question " + (i + 1));
    b.addEventListener("click", () => {
      if (!isPaused) goTo(i);
    });
    g.appendChild(b);
  });
}

function renderPalette() {
  [...$("pgrid").children].forEach((b, i) => {
    b.className =
      "pbtn" +
      (answers[i] !== null ? " answered" : visited[i] ? " seen" : "") +
      (marked[i] ? " marked" : "") +
      (i === cur ? " current" : "");
  });
}

/* ============================= pause & resume ============================= */
function pauseTest() {
  if (isPaused) return;
  commitTime();
  isPaused = true;
  clearInterval(mainTimer);
  clearInterval(qTimerTick);
  $("pauseModal").classList.add("active");

  // Persist state if part of saved tests
  const progressState = {
    remaining,
    answers,
    visited,
    marked,
    timeSpent,
    cur,
    testStartedAt
  };
  saveCurrentPaperToStorage($("testTitle").textContent.split(" · ")[0], progressState);
}

function resumeTest() {
  if (!isPaused) return;
  isPaused = false;
  enteredAt = Date.now();
  $("pauseModal").classList.remove("active");
  mainTimer = setInterval(tickClock, 1000);
  qTimerTick = setInterval(renderQTimer, 500);
}

$("pauseBtn").addEventListener("click", pauseTest);
$("resumeBtn").addEventListener("click", resumeTest);
$("saveAndExitBtn").addEventListener("click", () => {
  $("pauseModal").classList.remove("active");
  show("setup");
});

/* ============================= nav & shortcuts ============================= */
$("prevBtn").addEventListener("click", () => {
  if (!isPaused && cur > 0) goTo(cur - 1);
});
$("nextBtn").addEventListener("click", () => {
  if (isPaused) return;
  if (cur < paper.length - 1) goTo(cur + 1);
  else {
    commitTime();
    enteredAt = Date.now();
    renderPalette();
  }
});
$("clearBtn").addEventListener("click", () => {
  if (isPaused) return;
  answers[cur] = null;
  renderQuestion();
  renderPalette();
});
$("markBtn").addEventListener("click", () => {
  if (isPaused) return;
  marked[cur] = !marked[cur];
  renderQuestion();
  renderPalette();
});

$("submitBtn").addEventListener("click", () => {
  if (isPaused) return;
  const un = answers.filter((a) => a === null).length;
  const msg = un
    ? "You still have " + un + " unanswered question" + (un > 1 ? "s" : "") + ". Submit anyway?"
    : "Submit the test?";
  if (confirm(msg)) finishTest(false);
});

document.addEventListener("keydown", (e) => {
  if (!$("test").classList.contains("active") || isPaused) return;
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
  if (e.key === "ArrowRight" && cur < paper.length - 1) goTo(cur + 1);
  if (e.key === "ArrowLeft" && cur > 0) goTo(cur - 1);
  const k = e.key.toUpperCase().charCodeAt(0) - 65;
  if (k >= 0 && k < paper[cur].options.length && /^[a-zA-Z]$/.test(e.key)) {
    answers[cur] = answers[cur] === k ? null : k;
    renderQuestion();
    renderPalette();
  }
});

function finishTest(auto) {
  commitTime();
  clearInterval(mainTimer);
  clearInterval(qTimerTick);
  testEndedAt = Date.now();

  // Clear in-progress state in saved storage on submit
  if (activeTestId) {
    const tests = getSavedTests();
    const idx = tests.findIndex((t) => t.id === activeTestId);
    if (idx !== -1) {
      tests[idx].progress = null;
      persistSavedTests(tests);
    }
  }

  buildResults(auto);
  show("results");
}

/* ============================= results ============================= */
function buildResults(auto) {
  const n = paper.length;
  let correct = 0,
    wrong = 0,
    skipped = 0;
  const outcome = paper.map((q, i) => {
    if (answers[i] === null) {
      skipped++;
      return "skipped";
    }
    if (answers[i] === q.correct) {
      correct++;
      return "correct";
    }
    wrong++;
    return "wrong";
  });
  const attempted = correct + wrong;
  const accuracy = attempted ? Math.round((correct / attempted) * 100) : 0;
  const usedSec = Math.min(
    durationSec,
    Math.round((testEndedAt - testStartedAt) / 1000)
  );
  const avg = timeSpent.reduce((a, b) => a + b, 0) / n;

  $("verdictTitle").textContent = auto ? "Time's up — auto-submitted" : "Test complete";
  $("scoreBig").textContent = correct + " / " + n;
  $("accBig").textContent = accuracy + "%";

  $("statRow").innerHTML = [
    ["c", correct, "Correct"],
    ["w", wrong, "Wrong"],
    ["s", skipped, "Skipped"],
    ["", attempted, "Attempted"],
    ["", fmtDur(usedSec), "Time used of " + fmtDur(durationSec)],
    ["", fmtDur(avg), "Avg time / question"],
  ]
    .map(
      ([cls, v, l]) =>
        '<div class="stat ' + cls + '"><div class="v">' + v + '</div><div class="l">' + l + "</div></div>"
    )
    .join("");

  buildChart(outcome, avg);
  buildInsights(outcome, avg, correct, wrong, skipped, usedSec);
  buildReview(outcome);
}

function colorFor(o) {
  return o === "correct" ? "var(--correct)" : o === "wrong" ? "var(--wrong)" : "var(--warn)";
}

function buildChart(outcome, avg) {
  const n = paper.length;
  const barW = 34,
    gap = 12,
    padL = 46,
    padB = 26,
    padT = 14;
  const W = padL + n * (barW + gap) + 10;
  const H = 220;
  const maxT = Math.max(10, ...timeSpent, avg * 1.2);
  const y = (v) => padT + (H - padB - padT) * (1 - v / maxT);

  let s =
    '<svg width="' +
    Math.max(W, 320) +
    '" height="' +
    H +
    '" role="img" aria-label="Bar chart of time spent per question" style="display:block">';
  for (let g = 0; g <= 4; g++) {
    const v = (maxT * g) / 4,
      yy = y(v);
    s +=
      '<line x1="' +
      padL +
      '" y1="' +
      yy +
      '" x2="' +
      (W - 6) +
      '" y2="' +
      yy +
      '" stroke="var(--line)" stroke-width="1"/>';
    s +=
      '<text x="' +
      (padL - 8) +
      '" y="' +
      (yy + 4) +
      '" text-anchor="end" font-size="10" font-family="var(--mono)" fill="var(--muted)">' +
      Math.round(v) +
      "s</text>";
  }
  s +=
    '<line x1="' +
    padL +
    '" y1="' +
    y(avg) +
    '" x2="' +
    (W - 6) +
    '" y2="' +
    y(avg) +
    '" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4"/>';

  timeSpent.forEach((t, i) => {
    const x = padL + i * (barW + gap);
    const h = Math.max(2, (H - padB - padT) * (t / maxT));
    s +=
      '<rect x="' +
      x +
      '" y="' +
      (H - padB - h) +
      '" width="' +
      barW +
      '" height="' +
      h +
      '" rx="4" fill="' +
      colorFor(outcome[i]) +
      '"><title>Q' +
      (i + 1) +
      " · " +
      fmtDur(t) +
      " · " +
      outcome[i] +
      "</title></rect>";
    s +=
      '<text x="' +
      (x + barW / 2) +
      '" y="' +
      (H - 8) +
      '" text-anchor="middle" font-size="10" font-family="var(--mono)" fill="var(--muted)">' +
      (i + 1) +
      "</text>";
  });
  s += "</svg>";
  $("chartWrap").innerHTML = s;
}

function buildInsights(outcome, avg, correct, wrong, skipped, usedSec) {
  const ins = [];
  const n = paper.length;

  let slow = timeSpent.indexOf(Math.max(...timeSpent));
  if (timeSpent[slow] > 0) {
    ins.push([
      "⏱",
      "Q" + (slow + 1) + " took the longest — " + fmtDur(timeSpent[slow]) + " (" + outcome[slow] + "). " +
        (outcome[slow] !== "correct"
          ? "Long time with no payoff: a strong candidate to skip early and revisit."
          : "It paid off, but check if it was worth the budget."),
    ]);
  }
  const fcIdx = timeSpent
    .map((t, i) => ({ t, i }))
    .filter((x) => outcome[x.i] === "correct")
    .sort((a, b) => a.t - b.t)[0];
  if (fcIdx)
    ins.push(["⚡", "Fastest correct answer: Q" + (fcIdx.i + 1) + " in " + fmtDur(fcIdx.t) + "."]);

  const rushed = outcome
    .map((o, i) => (o === "wrong" && timeSpent[i] < Math.min(15, avg * 0.5) ? i : -1))
    .filter((i) => i >= 0);
  if (rushed.length)
    ins.push([
      "🚩",
      rushed.length + " wrong answer" + (rushed.length > 1 ? "s" : "") + " came in under " +
        Math.round(Math.min(15, avg * 0.5)) + "s (" + rushed.map((i) => "Q" + (i + 1)).join(", ") + "). These look rushed — slow down and re-read before marking.",
    ]);

  const sinks = timeSpent.map((t, i) => (t > avg * 2 && t > 30 ? i : -1)).filter((i) => i >= 0);
  if (sinks.length)
    ins.push(["🕳", sinks.map((i) => "Q" + (i + 1)).join(", ") + " took over twice your average. In the real exam, park these and return at the end."]);

  const skipTime = outcome.reduce((a, o, i) => a + (o === "skipped" ? timeSpent[i] : 0), 0);
  if (skipped && skipTime > avg)
    ins.push(["⚠", "You spent " + fmtDur(skipTime) + " on questions you ultimately left blank. Deciding to skip faster frees that time for scoring questions."]);

  const budgetPerQ = durationSec / n;
  if (usedSec < durationSec * 0.8 && (wrong > 0 || skipped > 0))
    ins.push(["🧭", "You finished with " + fmtDur(durationSec - usedSec) + " unused. With " + (wrong + skipped) + " questions not scored, that spare time could have gone into a second pass."]);
  else if (usedSec >= durationSec)
    ins.push(["🧭", "You ran the clock to zero. Your average was " + fmtDur(avg) + " against a budget of " + fmtDur(budgetPerQ) + " per question."]);

  const attempted = correct + wrong;
  if (attempted && correct / attempted >= 0.85 && skipped > n * 0.2)
    ins.push(["🎯", "Accuracy on attempts was high (" + Math.round((correct / attempted) * 100) + "%) but " + skipped + " were skipped — attempt-rate, not accuracy, is your bottleneck."]);

  $("insightList").innerHTML =
    ins
      .map(([ic, t]) => '<div class="insight"><span class="ic">' + ic + "</span><span>" + esc(t) + "</span></div>")
      .join("") || '<div class="insight"><span class="ic">✓</span><span>Clean run — nothing flagged.</span></div>';
}

function buildReview(outcome) {
  const body = $("reviewBody");
  body.innerHTML = "";
  const L = (i) => String.fromCharCode(65 + i);
  paper.forEach((q, i) => {
    const tr = document.createElement("tr");
    tr.className = "qrow";
    const your = answers[i] === null ? "—" : L(answers[i]) + ". " + q.options[answers[i]];
    tr.innerHTML =
      '<td class="tcell">Q' + esc(q.num) + "</td>" +
      "<td>" + esc(q.askedIn) + "</td>" +
      "<td>" + esc(your) + "</td>" +
      "<td>" + L(q.correct) + ". " + esc(q.options[q.correct]) + "</td>" +
      '<td class="tcell">' + fmtDur(timeSpent[i]) + "</td>" +
      '<td><span class="pill ' + outcome[i] + '">' + outcome[i].toUpperCase() + "</span></td>";
    const dr = document.createElement("tr");
    dr.className = "detail";
    dr.style.display = "none";
    dr.innerHTML =
      '<td colspan="6"><div class="dmeta">' + esc(q.askedIn) + "</div>" + esc(q.question) +
      '<div class="dopts">' +
      q.options
        .map((o, oi) => {
          let mark = oi === q.correct ? " ✓" : answers[i] === oi ? " ✗ (your answer)" : "";
          let col = oi === q.correct ? "var(--correct)" : answers[i] === oi ? "var(--wrong)" : "inherit";
          return '<span style="color:' + col + '">' + L(oi) + ". " + esc(o) + mark + "</span>";
        })
        .join("") +
      "</div></td>";
    tr.addEventListener("click", () => {
      dr.style.display = dr.style.display === "none" ? "" : "none";
    });
    body.appendChild(tr);
    body.appendChild(dr);
  });
}

$("retakeBtn").addEventListener("click", () => {
  startTest(false);
});
$("newPaperBtn").addEventListener("click", () => {
  show("setup");
});

// Initialize dashboard on load
renderSavedDashboard();