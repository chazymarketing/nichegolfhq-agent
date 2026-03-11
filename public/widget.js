/**
 * nichegolfHQ — Embeddable Chat Widget
 * ========================================
 * Drop this single <script> tag on any page to add the golf AI assistant:
 *
 *   <script src="https://YOUR-SERVER/widget.js" defer></script>
 *
 * Or self-host and set the data-api attribute:
 *
 *   <script src="/widget.js" data-api="https://your-api.com" defer></script>
 */

(function () {
  "use strict";

  // ── Config ───────────────────────────────────────────────
  const scriptTag = document.currentScript;
  const API_BASE =
    scriptTag?.getAttribute("data-api") ||
    scriptTag?.src.replace(/\/widget\.js.*$/, "") ||
    "";

  const BRAND = {
    name: "Golf Assistant",
    greeting:
      "Hey there! I'm the nichegolfHQ assistant. Ask me anything about competitive amateur golf — tournaments, rules, handicaps, strategy, you name it.",
    placeholder: "Ask about amateur golf...",
    accent: "#1a7a3a",       // Masters green
    accentLight: "#e8f5ec",
    accentDark: "#145a2c",
  };

  // ── State ────────────────────────────────────────────────
  let isOpen = false;
  let isLoading = false;
  let history = []; // [{role:'user'|'assistant', content:string}]

  // ── Styles ───────────────────────────────────────────────
  const CSS = `
    /* ── Reset ─────────────────────────────── */
    #ngh-widget, #ngh-widget * {
      box-sizing: border-box;
      margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                   "Helvetica Neue", Arial, sans-serif;
    }

    /* ── Launcher Button ───────────────────── */
    #ngh-launcher {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: ${BRAND.accent};
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #ngh-launcher:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 28px rgba(0,0,0,0.3);
    }
    #ngh-launcher svg {
      width: 28px; height: 28px; fill: white;
    }

    /* ── Chat Window ───────────────────────── */
    #ngh-chat {
      position: fixed;
      bottom: 96px;
      right: 24px;
      z-index: 99999;
      width: 380px;
      max-width: calc(100vw - 32px);
      height: 520px;
      max-height: calc(100vh - 120px);
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 12px 48px rgba(0,0,0,0.18);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      transform: translateY(16px) scale(0.96);
      pointer-events: none;
      transition: opacity 0.25s ease, transform 0.25s ease;
    }
    #ngh-chat.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    /* ── Header ────────────────────────────── */
    #ngh-header {
      background: ${BRAND.accent};
      color: white;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    #ngh-header-icon {
      width: 36px; height: 36px;
      background: rgba(255,255,255,0.2);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
    }
    #ngh-header-text h3 {
      font-size: 15px; font-weight: 600;
    }
    #ngh-header-text p {
      font-size: 11px; opacity: 0.85; margin-top: 2px;
    }
    #ngh-close {
      margin-left: auto;
      background: none; border: none; color: white;
      cursor: pointer; font-size: 20px; opacity: 0.8;
      width: 28px; height: 28px; display: flex;
      align-items: center; justify-content: center;
      border-radius: 6px;
    }
    #ngh-close:hover { opacity: 1; background: rgba(255,255,255,0.15); }

    /* ── Messages ──────────────────────────── */
    #ngh-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #fafbfc;
    }
    .ngh-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .ngh-msg.user {
      align-self: flex-end;
      background: ${BRAND.accent};
      color: white;
      border-bottom-right-radius: 4px;
    }
    .ngh-msg.assistant {
      align-self: flex-start;
      background: white;
      color: #1a1a1a;
      border: 1px solid #e5e7eb;
      border-bottom-left-radius: 4px;
    }
    .ngh-msg.greeting {
      background: ${BRAND.accentLight};
      border: 1px solid ${BRAND.accent}33;
      color: #1a3a1a;
    }

    /* ── Typing indicator ──────────────────── */
    .ngh-typing {
      display: flex; gap: 5px; padding: 12px 16px;
      align-self: flex-start;
    }
    .ngh-typing span {
      width: 8px; height: 8px;
      background: ${BRAND.accent};
      border-radius: 50%;
      opacity: 0.4;
      animation: ngh-bounce 1.2s infinite;
    }
    .ngh-typing span:nth-child(2) { animation-delay: 0.15s; }
    .ngh-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes ngh-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-6px); opacity: 1; }
    }

    /* ── Input Area ────────────────────────── */
    #ngh-input-area {
      padding: 12px 16px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      gap: 8px;
      background: white;
      flex-shrink: 0;
    }
    #ngh-input {
      flex: 1;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 14px;
      outline: none;
      resize: none;
      max-height: 80px;
      min-height: 40px;
      line-height: 1.4;
    }
    #ngh-input:focus {
      border-color: ${BRAND.accent};
      box-shadow: 0 0 0 2px ${BRAND.accent}22;
    }
    #ngh-send {
      width: 40px; height: 40px;
      border-radius: 10px;
      background: ${BRAND.accent};
      border: none;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    #ngh-send:hover { background: ${BRAND.accentDark}; }
    #ngh-send:disabled { opacity: 0.5; cursor: not-allowed; }
    #ngh-send svg { width: 18px; height: 18px; fill: white; }

    /* ── Footer ────────────────────────────── */
    #ngh-footer {
      text-align: center;
      padding: 6px;
      font-size: 10px;
      color: #999;
      background: white;
      border-top: 1px solid #f0f0f0;
    }
    #ngh-footer a { color: ${BRAND.accent}; text-decoration: none; }

    /* ── Mobile ─────────────────────────────── */
    @media (max-width: 440px) {
      #ngh-chat {
        width: calc(100vw - 16px);
        height: calc(100vh - 100px);
        right: 8px;
        bottom: 80px;
        border-radius: 12px;
      }
    }
  `;

  // ── Build DOM ────────────────────────────────────────────

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function createWidget() {
    const wrapper = document.createElement("div");
    wrapper.id = "ngh-widget";
    wrapper.innerHTML = `
      <!-- Launcher -->
      <button id="ngh-launcher" aria-label="Open golf assistant chat">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.04 2 11c0 2.76 1.36 5.22 3.5 6.84V22l3.94-2.16c.82.22 1.68.34 2.56.34 5.52 0 10-4.04 10-9S17.52 2 12 2zm1 12h-4a1 1 0 110-2h4a1 1 0 110 2zm2-4H9a1 1 0 110-2h6a1 1 0 110 2z"/>
        </svg>
      </button>

      <!-- Chat Window -->
      <div id="ngh-chat">
        <div id="ngh-header">
          <div id="ngh-header-icon">⛳</div>
          <div id="ngh-header-text">
            <h3>${BRAND.name}</h3>
            <p>Powered by nichegolfHQ</p>
          </div>
          <button id="ngh-close" aria-label="Close chat">&times;</button>
        </div>

        <div id="ngh-messages">
          <div class="ngh-msg assistant greeting">${BRAND.greeting}</div>
        </div>

        <div id="ngh-input-area">
          <textarea
            id="ngh-input"
            placeholder="${BRAND.placeholder}"
            rows="1"
            maxlength="2000"
          ></textarea>
          <button id="ngh-send" aria-label="Send message">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>

        <div id="ngh-footer">
          Built with AI by <a href="https://nichegolfhq.com" target="_blank">nichegolfHQ</a>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);
  }

  // ── Interactions ─────────────────────────────────────────

  function toggle() {
    isOpen = !isOpen;
    document.getElementById("ngh-chat").classList.toggle("open", isOpen);
    if (isOpen) {
      setTimeout(() => document.getElementById("ngh-input").focus(), 300);
    }
  }

  function addMessage(role, content) {
    const container = document.getElementById("ngh-messages");
    const div = document.createElement("div");
    div.className = `ngh-msg ${role}`;
    div.textContent = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function showTyping() {
    const container = document.getElementById("ngh-messages");
    const div = document.createElement("div");
    div.className = "ngh-typing";
    div.id = "ngh-typing-indicator";
    div.innerHTML = "<span></span><span></span><span></span>";
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById("ngh-typing-indicator");
    if (el) el.remove();
  }

  async function sendMessage() {
    const input = document.getElementById("ngh-input");
    const text = input.value.trim();
    if (!text || isLoading) return;

    // Add user message
    addMessage("user", text);
    history.push({ role: "user", content: text });
    input.value = "";
    input.style.height = "auto";

    // Show loading state
    isLoading = true;
    document.getElementById("ngh-send").disabled = true;
    showTyping();

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: history.slice(-20),
        }),
      });

      const data = await res.json();

      if (res.ok) {
        hideTyping();
        addMessage("assistant", data.reply);
        history.push({ role: "assistant", content: data.reply });
      } else {
        hideTyping();
        addMessage(
          "assistant",
          data.error || "Sorry, something went wrong. Please try again."
        );
      }
    } catch (err) {
      hideTyping();
      addMessage(
        "assistant",
        "Hmm, I can't connect to the server right now. Please try again in a moment."
      );
    }

    isLoading = false;
    document.getElementById("ngh-send").disabled = false;
  }

  // ── Auto-resize textarea ─────────────────────────────────

  function autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + "px";
  }

  // ── Init ─────────────────────────────────────────────────

  function init() {
    injectStyles();
    createWidget();

    // Event listeners
    document.getElementById("ngh-launcher").addEventListener("click", toggle);
    document.getElementById("ngh-close").addEventListener("click", toggle);
    document.getElementById("ngh-send").addEventListener("click", sendMessage);

    const input = document.getElementById("ngh-input");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener("input", () => autoResize(input));
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
