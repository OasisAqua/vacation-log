"use strict";

const STORAGE_KEY = "vacation-log-v1";
const DEFAULT_TITLE = "인생은휴가지";

const LEAVE_TYPES = ["연차", "오전반차", "오후반차", "오전반반차", "오후반반차", "기타"];

const ONE_OFF_HOLIDAYS = {
  "2026-06-03": "전국동시지방선거"
};

const today = new Date();
const state = loadState();
let viewDate = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedDateKey = null;
let selectedParts = new Set();
let deferredInstallPrompt = null;
let toastTimer = null;
let jumpYear = viewDate.getFullYear();
const holidayCache = new Map();

const refs = {
  title: document.querySelector("#motivational-title"),
  monthPicker: document.querySelector("#month-picker"),
  monthHeading: document.querySelector("#month-heading"),
  leaveCount: document.querySelector("#leave-count"),
  calendar: document.querySelector("#calendar-grid"),
  entryDialog: document.querySelector("#entry-dialog"),
  entryForm: document.querySelector("#entry-form"),
  entryDateLabel: document.querySelector("#entry-date-label"),
  entryTitle: document.querySelector("#entry-title"),
  bodyPartGrid: document.querySelector("#body-part-grid"),
  entryNote: document.querySelector("#entry-note"),
  noteCount: document.querySelector("#note-count"),
  deleteEntry: document.querySelector("#delete-entry"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  customTitle: document.querySelector("#custom-title"),
  installButton: document.querySelector("#install-app"),
  toast: document.querySelector("#toast"),
  jumpDialog: document.querySelector("#jump-dialog"),
  jumpYearLabel: document.querySelector("#jump-year-label"),
  jumpMonthGrid: document.querySelector("#jump-month-grid"),
  jumpPrevYear: document.querySelector("#jump-prev-year"),
  jumpNextYear: document.querySelector("#jump-next-year"),
  jumpToday: document.querySelector("#jump-today")
};

function loadState() {
  const fallback = { entries: {}, settings: { customTitle: DEFAULT_TITLE, theme: "paper" } };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || typeof stored !== "object") return fallback;
    return {
      entries: stored.entries && typeof stored.entries === "object" ? stored.entries : {},
      settings: {
        customTitle: sanitizeTitle(stored.settings?.customTitle) || DEFAULT_TITLE,
        theme: normalizeTheme(stored.settings?.theme)
      }
    };
  } catch {
    return fallback;
  }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function sanitizeTitle(value) {
  return typeof value === "string" ? value.trim().slice(0, 18) : "";
}

function normalizeTheme(value) {
  return ["paper", "white", "black", "gray"].includes(value) ? value : "paper";
}

function applyTheme(theme) {
  const normalized = normalizeTheme(theme);
  document.documentElement.dataset.theme = normalized;
  const themeColors = { paper: "#f7f2e8", white: "#ffffff", black: "#111318", gray: "#d6dadd" };
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColors[normalized]);
}

function formatDateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function keyFromDate(date) {
  return formatDateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function renderTitle() {
  refs.title.textContent = state.settings.customTitle || DEFAULT_TITLE;
}

function renderMonthPicker() {
  refs.monthPicker.innerHTML = "";
  for (let month = 0; month < 12; month += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "month-button";
    button.textContent = String(month + 1);
    button.setAttribute("aria-label", `${month + 1}월`);
    button.setAttribute("aria-current", String(month === viewDate.getMonth()));
    button.addEventListener("click", () => {
      viewDate = new Date(viewDate.getFullYear(), month, 1);
      render();
    });
    refs.monthPicker.append(button);
  }
}

function lunarParts(date) {
  const safeDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 3));
  const parts = new Intl.DateTimeFormat("en-u-ca-chinese", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric"
  }).formatToParts(safeDate);
  return {
    month: parts.find((part) => part.type === "month")?.value,
    day: Number(parts.find((part) => part.type === "day")?.value)
  };
}

function holidayData(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);

  const holidayMap = new Map();
  const baseEntries = [];

  const addBase = (date, name, weekendRule = "none", substituteEligible = false) => {
    const key = keyFromDate(date);
    const item = { date, key, name, weekendRule, substituteEligible };
    baseEntries.push(item);
    const current = holidayMap.get(key) || [];
    current.push(name);
    holidayMap.set(key, current);
  };

  const fixed = [
    [0, 1, "신정", "none", false],
    [2, 1, "삼일절", "weekend", true],
    [4, 5, "어린이날", "weekend", true],
    [5, 6, "현충일", "none", false],
    [7, 15, "광복절", "weekend", true],
    [9, 3, "개천절", "weekend", true],
    [9, 9, "한글날", "weekend", true],
    [11, 25, "성탄절", "weekend", true]
  ];

  fixed.forEach(([month, day, name, rule, eligible]) => addBase(new Date(year, month, day), name, rule, eligible));

  if (year >= 2026) {
    addBase(new Date(year, 4, 1), "노동절", "weekend", true);
    addBase(new Date(year, 6, 17), "제헌절", "weekend", true);
  }

  const lunarTargets = [];
  for (let cursor = new Date(year, 0, 1); cursor.getFullYear() === year; cursor = addDays(cursor, 1)) {
    const lunar = lunarParts(cursor);
    if (lunar.month === "1" && lunar.day === 1) lunarTargets.push([cursor, "설"]);
    if (lunar.month === "4" && lunar.day === 8) lunarTargets.push([cursor, "부처님오신날"]);
    if (lunar.month === "8" && lunar.day === 15) lunarTargets.push([cursor, "추석"]);
  }

  lunarTargets.forEach(([date, kind]) => {
    if (kind === "설") {
      addBase(addDays(date, -1), "설 연휴", "sunday", true);
      addBase(date, "설날", "sunday", true);
      addBase(addDays(date, 1), "설 연휴", "sunday", true);
    } else if (kind === "추석") {
      addBase(addDays(date, -1), "추석 연휴", "sunday", true);
      addBase(date, "추석", "sunday", true);
      addBase(addDays(date, 1), "추석 연휴", "sunday", true);
    } else {
      addBase(date, kind, "weekend", true);
    }
  });

  Object.entries(ONE_OFF_HOLIDAYS).forEach(([key, name]) => {
    if (Number(key.slice(0, 4)) === year) addBase(dateFromKey(key), name, "none", false);
  });

  const needsSubstitute = baseEntries.filter((item) => {
    const day = item.date.getDay();
    const collision = item.substituteEligible && (holidayMap.get(item.key)?.length || 0) > 1 && day !== 0 && day !== 6;
    return (item.weekendRule === "weekend" && (day === 0 || day === 6)) ||
      (item.weekendRule === "sunday" && day === 0) || collision;
  });

  const occupiedSubstitutes = new Set();
  needsSubstitute.forEach((item) => {
    let substitute = addDays(item.date, 1);
    while (
      substitute.getDay() === 0 ||
      substitute.getDay() === 6 ||
      holidayMap.has(keyFromDate(substitute)) ||
      occupiedSubstitutes.has(keyFromDate(substitute))
    ) {
      substitute = addDays(substitute, 1);
    }
    const substituteKey = keyFromDate(substitute);
    occupiedSubstitutes.add(substituteKey);
    const current = holidayMap.get(substituteKey) || [];
    current.push(`대체공휴일 (${item.name.replace(" 연휴", "")})`);
    holidayMap.set(substituteKey, current);
  });

  const normalized = new Map([...holidayMap].map(([key, names]) => [key, [...new Set(names)].join(" · ")]));
  holidayCache.set(year, normalized);
  return normalized;
}

function renderCalendar() {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const holidays = holidayData(year);
  const cellCount = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  refs.monthHeading.textContent = `${year}년 ${month + 1}월`;
  refs.calendar.innerHTML = "";

  const monthlyEntries = Object.keys(state.entries).filter((key) => key.startsWith(`${year}-${String(month + 1).padStart(2, "0")}-`));
  refs.leaveCount.textContent = `휴가 ${monthlyEntries.length}일`;

  for (let index = 0; index < cellCount; index += 1) {
    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    cell.setAttribute("role", "gridcell");
    const day = index - firstDay + 1;

    if (day < 1 || day > daysInMonth) {
      cell.classList.add("empty");
      cell.setAttribute("aria-hidden", "true");
      refs.calendar.append(cell);
      continue;
    }

    const date = new Date(year, month, day);
    const key = formatDateKey(year, month, day);
    const holidayName = holidays.get(key) || "";
    const entry = state.entries[key];
    const isHoliday = date.getDay() === 0 || Boolean(holidayName);
    const isToday = sameDay(date, today);

    if (isHoliday) cell.classList.add("is-holiday");
    if (isToday) cell.classList.add("is-today");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "day-button";
    const entryDescription = entry ? `, 휴가 ${entry.parts.join(", ")}${entry.note ? `, ${entry.note}` : ""}` : "";
    button.setAttribute("aria-label", `${year}년 ${month + 1}월 ${day}일${holidayName ? `, ${holidayName}` : ""}${entryDescription}`);
    button.innerHTML = `
      <span class="day-topline">
        <span class="day-number">${day}</span>
        ${entry ? '<i class="entry-mark" aria-hidden="true"></i>' : ""}
      </span>
      <span class="holiday-name">${escapeHtml(holidayName)}</span>
      ${entry ? `<span class="entry-parts">${escapeHtml(entry.parts.join(" · "))}</span>` : ""}
      ${entry?.note ? `<span class="entry-note-preview">${escapeHtml(entry.note)}</span>` : ""}
    `;
    button.addEventListener("click", () => openEntryDialog(key));
    cell.append(button);
    refs.calendar.append(cell);
  }
}

function render() {
  renderTitle();
  renderMonthPicker();
  renderCalendar();
}

function openEntryDialog(key) {
  selectedDateKey = key;
  const date = dateFromKey(key);
  const holidayName = holidayData(date.getFullYear()).get(key);
  const entry = state.entries[key];
  selectedParts = new Set(entry?.parts || []);
  refs.entryDateLabel.textContent = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${["일", "월", "화", "수", "목", "금", "토"][date.getDay()]}요일`;
  refs.entryTitle.textContent = holidayName || "휴가 기록";
  refs.entryNote.value = entry?.note || "";
  refs.noteCount.textContent = String(refs.entryNote.value.length);
  refs.deleteEntry.hidden = !entry;
  renderLeaveTypes();
  refs.entryDialog.showModal();
}

function renderLeaveTypes() {
  refs.bodyPartGrid.innerHTML = "";
  LEAVE_TYPES.forEach((part) => {
    const label = document.createElement("label");
    label.className = "body-part-option";
    label.innerHTML = `<input type="checkbox" value="${part}" ${selectedParts.has(part) ? "checked" : ""} /><span>${part}</span>`;
    const input = label.querySelector("input");
    input.addEventListener("change", () => {
      if (input.checked) selectedParts.add(part);
      else selectedParts.delete(part);
    });
    refs.bodyPartGrid.append(label);
  });
}

function openSettings() {
  refs.settingsForm.elements.theme.value = state.settings.theme;
  refs.customTitle.value = state.settings.customTitle;
  refs.settingsDialog.showModal();
}

function renderJumpMonths() {
  refs.jumpYearLabel.textContent = `${jumpYear}년`;
  refs.jumpMonthGrid.innerHTML = "";
  for (let month = 0; month < 12; month += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jump-month-button";
    button.textContent = `${month + 1}월`;
    button.setAttribute("aria-current", String(jumpYear === viewDate.getFullYear() && month === viewDate.getMonth()));
    button.addEventListener("click", () => {
      viewDate = new Date(jumpYear, month, 1);
      render();
      refs.jumpDialog.close();
    });
    refs.jumpMonthGrid.append(button);
  }
}

function openJumpDialog() {
  jumpYear = viewDate.getFullYear();
  renderJumpMonths();
  refs.jumpDialog.showModal();
}

function changeMonth(amount) {
  viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + amount, 1);
  render();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  clearTimeout(toastTimer);
  refs.toast.textContent = message;
  refs.toast.classList.add("show");
  toastTimer = setTimeout(() => refs.toast.classList.remove("show"), 1800);
}

refs.entryNote.addEventListener("input", () => {
  refs.noteCount.textContent = String(refs.entryNote.value.length);
});

refs.entryForm.addEventListener("submit", (event) => {
  const action = event.submitter?.value;
  if (action === "cancel") return;
  event.preventDefault();

  if (action === "delete") {
    delete state.entries[selectedDateKey];
    saveState();
    refs.entryDialog.close();
    renderCalendar();
    showToast("기록을 지웠어요");
    return;
  }

  const note = refs.entryNote.value.trim().slice(0, 24);
  if (selectedParts.size === 0 && !note) {
    showToast("휴가 종류나 메모를 하나 남겨주세요");
    return;
  }
  state.entries[selectedDateKey] = { parts: [...selectedParts], note };
  saveState();
  refs.entryDialog.close();
  renderCalendar();
  showToast("오늘의 휴가를 기록했어요");
});

refs.settingsForm.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  state.settings.customTitle = sanitizeTitle(refs.customTitle.value) || DEFAULT_TITLE;
  state.settings.theme = normalizeTheme(refs.settingsForm.elements.theme.value);
  saveState();
  refs.settingsDialog.close();
  renderTitle();
  applyTheme(state.settings.theme);
  showToast("설정을 저장했어요");
});

refs.settingsForm.elements.theme.forEach((input) => {
  input.addEventListener("change", () => applyTheme(input.value));
});
refs.settingsDialog.addEventListener("close", () => applyTheme(state.settings.theme));
document.querySelector("#open-settings").addEventListener("click", openSettings);
document.querySelector("#prev-month").addEventListener("click", () => changeMonth(-1));
document.querySelector("#next-month").addEventListener("click", () => changeMonth(1));
document.querySelector("#open-jump").addEventListener("click", openJumpDialog);
refs.jumpPrevYear.addEventListener("click", () => {
  jumpYear -= 1;
  renderJumpMonths();
});
refs.jumpNextYear.addEventListener("click", () => {
  jumpYear += 1;
  renderJumpMonths();
});
refs.jumpToday.addEventListener("click", () => {
  viewDate = new Date(today.getFullYear(), today.getMonth(), 1);
  render();
  refs.jumpDialog.close();
});

[refs.entryDialog, refs.settingsDialog, refs.jumpDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  refs.installButton.hidden = false;
});

refs.installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  refs.installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

applyTheme(state.settings.theme);
render();
