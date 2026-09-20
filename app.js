import { firebaseConfig, ADMIN_EMAIL } from "./firebase-init.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot,
  doc, updateDoc, deleteDoc, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

(function () {
  "use strict";

  /* ---------------- Wheel picker ---------------- */
  function createWheel(container, initialValue, onChange) {
    var ITEM_H = 56, COPIES = 13, CENTER = 6;
    var track = container.querySelector(".wheel-track");
    var html = "";
    for (var c = 0; c < COPIES; c++) {
      for (var d = 0; d < 10; d++) { html += '<div class="wheel-item">' + d + "</div>"; }
    }
    track.innerHTML = html;
    var items = track.children;
    var index = CENTER * 10 + initialValue;
    var minIndex = 4, maxIndex = COPIES * 10 - 5;
    var dragging = false, startY = 0, startIndex = 0;

    function clamp(v) { return Math.min(maxIndex, Math.max(minIndex, v)); }
    function apply(animate) {
      track.style.transition = animate ? "transform .25s cubic-bezier(.2,.8,.2,1)" : "none";
      var base = (container.clientHeight / 2) - (ITEM_H / 2);
      track.style.transform = "translateY(" + (base - index * ITEM_H) + "px)";
      var nearest = Math.round(index);
      for (var i = 0; i < items.length; i++) { items[i].classList.toggle("active", i === nearest); }
    }
    function getValue() { var n = Math.round(index) % 10; return n < 0 ? n + 10 : n; }

    container.addEventListener("pointerdown", function (e) {
      dragging = true; startY = e.clientY; startIndex = index;
      try { container.setPointerCapture(e.pointerId); } catch (err) {}
      track.style.transition = "none";
    });
    container.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dy = e.clientY - startY;
      index = clamp(startIndex - dy / ITEM_H);
      apply(false);
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      index = clamp(Math.round(index));
      apply(true);
      if (onChange) onChange(getValue());
    }
    container.addEventListener("pointerup", endDrag);
    container.addEventListener("pointercancel", endDrag);
    container.addEventListener("wheel", function (e) {
      e.preventDefault();
      index = clamp(index + (e.deltaY > 0 ? 1 : -1));
      apply(true);
      if (onChange) onChange(getValue());
    }, { passive: false });

    apply(false);
    return {
      get value() { return getValue(); },
      stepBy: function (delta) {
        index = clamp(Math.round(index) + delta);
        apply(true);
        if (onChange) onChange(getValue());
      }
    };
  }

  var tensWheel = createWheel(document.getElementById("wheelTens"), 0);
  var unitsWheel = createWheel(document.getElementById("wheelUnits"), 0);

  document.querySelectorAll(".wheel-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var w = btn.getAttribute("data-wheel") === "tens" ? tensWheel : unitsWheel;
      w.stepBy(parseInt(btn.getAttribute("data-dir"), 10));
    });
  });

  // Layout is RTL, so the first wheel in the markup (id="wheelTens") renders
  // on the RIGHT and the second (id="wheelUnits") renders on the LEFT.
  // The room number should read left-to-right like any number, so the left
  // wheel is the first digit and the right wheel is the second digit.
  function getCombo() { return "" + unitsWheel.value + tensWheel.value; }

  /* ---------------- Toast ---------------- */
  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function showToast(msg, isDanger) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("danger", !!isDanger);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  /* ---------------- Submit request (public, no login needed) ---------------- */
  var sendBtn = document.getElementById("sendBtn");
  var holdTimer = null, holdFired = false;

  async function submitRequest(room) {
    try {
      await addDoc(collection(db, "requests"), {
        room: room,
        status: "pending",
        createdAt: serverTimestamp()
      });
      showToast("הבקשה לחדר " + room + " נשלחה בהצלחה");
    } catch (err) {
      console.error(err);
      showToast("שליחת הבקשה נכשלה, נסו שוב", true);
    }
  }

  sendBtn.addEventListener("pointerdown", function () {
    holdFired = false;
    sendBtn.classList.add("pressing");
    holdTimer = setTimeout(function () {
      if (getCombo() === "67") { holdFired = true; openAdminAuth(); }
    }, 600);
  });
  function releasePress(shouldSend) {
    clearTimeout(holdTimer);
    sendBtn.classList.remove("pressing");
    if (shouldSend && !holdFired) { submitRequest(getCombo()); }
  }
  sendBtn.addEventListener("pointerup", function () { releasePress(true); });
  sendBtn.addEventListener("pointerleave", function () { releasePress(false); });
  sendBtn.addEventListener("pointercancel", function () { releasePress(false); });

  /* ---------------- Admin Google sign-in ---------------- */
  var authOverlay = document.getElementById("authOverlay");
  var authCard = document.getElementById("authCard");
  var authError = document.getElementById("authError");

  function openAdminAuth() {
    if (auth.currentUser && auth.currentUser.email === ADMIN_EMAIL) {
      enterAdmin();
      return;
    }
    authError.hidden = true;
    authOverlay.hidden = false;
  }
  function closeAdminAuth() { authOverlay.hidden = true; }
  function showAuthError(msg) {
    authError.textContent = msg;
    authError.hidden = false;
    authCard.classList.remove("shake"); void authCard.offsetWidth; authCard.classList.add("shake");
  }

  document.getElementById("authCancel").addEventListener("click", closeAdminAuth);
  authOverlay.addEventListener("click", function (e) { if (e.target === authOverlay) closeAdminAuth(); });

  document.getElementById("googleSignInBtn").addEventListener("click", async function () {
    try {
      var provider = new GoogleAuthProvider();
      var result = await signInWithPopup(auth, provider);
      if (result.user.email === ADMIN_EMAIL) {
        closeAdminAuth();
        enterAdmin();
      } else {
        await signOut(auth);
        showAuthError("החשבון " + result.user.email + " אינו מורשה לניהול");
      }
    } catch (err) {
      console.error(err);
      showAuthError("ההתחברות נכשלה, נסו שוב");
    }
  });

  /* ---------------- Admin panel ---------------- */
  var kioskEl = document.getElementById("kiosk");
  var adminEl = document.getElementById("admin");
  var ticketListEl = document.getElementById("ticketList");
  var actionCountsEl = document.getElementById("actionCounts");
  var dbNoteEl = document.getElementById("dbNote");
  var requestsCache = [];
  var currentFilter = "all";
  var unsubscribeFn = null;
  var pendingDelete = null;

  function enterAdmin() {
    kioskEl.classList.add("hidden-view");
    adminEl.classList.add("open");
    dbNoteEl.hidden = true;
    var q = query(collection(db, "requests"), orderBy("createdAt", "desc"), limit(500));
    unsubscribeFn = onSnapshot(q, function (snap) {
      requestsCache = snap.docs.map(function (d) {
        var data = d.data() || {};
        var createdAt = data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : Date.now();
        return { id: d.id, room: data.room, status: data.status || "pending", createdAt: createdAt };
      });
      renderTickets();
    }, function () {
      dbNoteEl.hidden = false;
    });
  }
  function exitAdmin() {
    kioskEl.classList.remove("hidden-view");
    adminEl.classList.remove("open");
    if (unsubscribeFn) { unsubscribeFn(); unsubscribeFn = null; }
    pendingDelete = null;
  }
  document.getElementById("exitAdminBtn").addEventListener("click", exitAdmin);
  document.getElementById("signOutBtn").addEventListener("click", async function () {
    try { await signOut(auth); } catch (err) {}
    exitAdmin();
  });

  document.querySelectorAll(".chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      document.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
      currentFilter = chip.getAttribute("data-filter");
      renderTickets();
    });
  });

  function heDate(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    var diffMin = Math.round((Date.now() - ts) / 60000);
    if (diffMin < 1) return "הרגע";
    if (diffMin < 60) return "לפני " + diffMin + " דק'";
    var diffH = Math.round(diffMin / 60);
    if (diffH < 24) return "לפני " + diffH + " שע'";
    return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  }

  function renderTickets() {
    var items = requestsCache.filter(function (r) {
      return currentFilter === "all" ? true : r.status === currentFilter;
    });
    var pendingCount = requestsCache.filter(function (r) { return r.status !== "done"; }).length;
    var doneCount = requestsCache.length - pendingCount;
    actionCountsEl.innerHTML =
      "<span><b>" + pendingCount + "</b> ממתינות</span>" +
      "<span><b>" + doneCount + "</b> טופלו</span>" +
      "<span><b>" + requestsCache.length + "</b> סה\"כ</span>";

    if (!items.length) {
      ticketListEl.innerHTML = '<div class="empty-note">אין בקשות להצגה</div>';
      return;
    }
    ticketListEl.innerHTML = "";
    items.forEach(function (r) {
      var isDone = r.status === "done";
      var row = document.createElement("div");
      row.className = "ticket";
      row.innerHTML =
        '<div class="ticket-room">' + r.room + "</div>" +
        '<div class="ticket-body">' +
        '<span class="status-chip ' + (isDone ? "done" : "pending") + '">' + (isDone ? "טופל" : "ממתין") + "</span>" +
        '<span class="ticket-time">' + heDate(r.createdAt) + "</span>" +
        "</div>" +
        '<div class="ticket-actions">' +
        '<button class="icon-btn done-toggle' + (isDone ? " is-done" : "") + '" data-id="' + r.id + '" data-status="' + r.status + '" title="' + (isDone ? "החזר לממתין" : "סמן כטופל") + '">' +
        (isDone
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/></svg>') +
        "</button>" +
        '<button class="icon-btn delete-btn" data-id="' + r.id + '" title="מחק">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></svg>' +
        "</button>" +
        "</div>";
      ticketListEl.appendChild(row);
    });
  }

  ticketListEl.addEventListener("click", async function (e) {
    var toggleBtn = e.target.closest(".done-toggle");
    var delBtn = e.target.closest(".delete-btn");
    if (toggleBtn) {
      var id = toggleBtn.getAttribute("data-id");
      var curStatus = toggleBtn.getAttribute("data-status");
      var next = curStatus === "done" ? "pending" : "done";
      toggleBtn.disabled = true;
      try { await updateDoc(doc(db, "requests", id), { status: next }); }
      catch (err) { showToast("העדכון נכשל", true); }
      toggleBtn.disabled = false;
      return;
    }
    if (delBtn) {
      var did = delBtn.getAttribute("data-id");
      if (pendingDelete !== did) {
        pendingDelete = did;
        delBtn.classList.add("danger-confirm");
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
        delBtn.title = "לאישור מחיקה - לחצו שוב";
        setTimeout(function () { if (pendingDelete === did) pendingDelete = null; renderTickets(); }, 3000);
        return;
      }
      pendingDelete = null;
      try { await deleteDoc(doc(db, "requests", did)); }
      catch (err) { showToast("המחיקה נכשלה", true); }
      return;
    }
  });

  document.getElementById("deleteDoneBtn").addEventListener("click", async function () {
    var done = requestsCache.filter(function (r) { return r.status === "done"; });
    if (!done.length) { showToast("אין קריאות טופלות למחיקה"); return; }
    try {
      await Promise.all(done.map(function (r) { return deleteDoc(doc(db, "requests", r.id)); }));
      showToast("נמחקו " + done.length + " קריאות טופלות");
    } catch (err) { showToast("המחיקה נכשלה", true); }
  });

  function buildWhatsAppText(filterStatus) {
    var items = requestsCache.filter(function (r) { return filterStatus === "all" ? true : r.status === filterStatus; });
    if (!items.length) return null;
    var lines = items.map(function (r) {
      return "חדר " + r.room + " — " + (r.status === "done" ? "טופל" : "ממתין") + " (" + heDate(r.createdAt) + ")";
    });
    var title = filterStatus === "all" ? "כל קריאות התחזוקה" : (filterStatus === "done" ? "קריאות שטופלו" : "קריאות ממתינות");
    return title + ":\n\n" + lines.join("\n");
  }
  document.querySelectorAll("[data-wa]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = buildWhatsAppText(btn.getAttribute("data-wa"));
      if (!text) { showToast("אין קריאות להצגה"); return; }
      window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
    });
  });

  document.getElementById("exportBtn").addEventListener("click", function () {
    if (!requestsCache.length) { showToast("אין נתונים לייצוא"); return; }
    var header = "חדר,סטטוס,נוצר\n";
    var rows = requestsCache.map(function (r) {
      return r.room + "," + (r.status === "done" ? "טופל" : "ממתין") + "," + heDate(r.createdAt);
    });
    var csv = "﻿" + header + rows.join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "בקשות-תחזוקה.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

})();
