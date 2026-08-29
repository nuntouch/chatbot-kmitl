```javascript
const chatWindow = document.getElementById("chat-window");
const emptyState = document.getElementById("empty-state");
const loadingIndicator = document.getElementById("loading-indicator");
const errorBanner = document.getElementById("error-banner");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const stopButton = document.getElementById("stop-button");
const newChatButton = document.getElementById("new-chat-button");

// =====================================================
// AUTHOR INFORMATION
// =====================================================

const authorName = "Nuntouchaporn Pheanpricha";

// สร้างชื่อผู้จัดทำใน UI
const authorElement = document.createElement("div");
authorElement.className = "author-name";
authorElement.textContent = `Developed by ${authorName}`;

// เพิ่มชื่อไว้ด้านบนของหน้า
document.body.prepend(authorElement);

// =====================================================
// ABORT CONTROLLER
// =====================================================

// เก็บ AbortController ของ request ที่กำลังทำงานอยู่
// เพื่อให้ปุ่ม "หยุด" สามารถยกเลิกการตอบกลับได้
let activeAbortController = null;


// =====================================================
// MARKDOWN RENDERING
// =====================================================

function renderMarkdown(rawText) {
  const html = marked.parse(rawText, {
    breaks: true
  });

  return DOMPurify.sanitize(html);
}


// =====================================================
// EMPTY STATE
// =====================================================

function hideEmptyState() {
  emptyState.classList.add("hidden");
}

function showEmptyState() {
  emptyState.classList.remove("hidden");
}


// =====================================================
// USER MESSAGE
// =====================================================

function appendUserMessage(text) {
  hideEmptyState();

  const wrapper = document.createElement("div");
  wrapper.className = "message user";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  bubble.textContent = text;

  wrapper.appendChild(bubble);

  chatWindow.insertBefore(
    wrapper,
    loadingIndicator
  );

  scrollToBottom();
}


// =====================================================
// AI MESSAGE
// =====================================================

function createAiBubble() {
  const wrapper = document.createElement("div");
  wrapper.className = "message ai";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  wrapper.appendChild(bubble);

  chatWindow.insertBefore(
    wrapper,
    loadingIndicator
  );

  scrollToBottom();

  return bubble;
}


// =====================================================
// SCROLL
// =====================================================

function scrollToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}


// =====================================================
// ERROR / NOTICE
// =====================================================

function showError(message) {
  errorBanner.classList.remove("notice");

  errorBanner.textContent = message;

  errorBanner.classList.remove("hidden");

  console.error(
    "[chat] error:",
    message
  );
}

function showNotice(message) {
  errorBanner.classList.add("notice");

  errorBanner.textContent = message;

  errorBanner.classList.remove("hidden");
}

function clearError() {
  errorBanner.classList.add("hidden");

  errorBanner.classList.remove("notice");

  errorBanner.textContent = "";
}


// =====================================================
// BUSY STATE
// =====================================================

function setBusy(isBusy) {
  // ปิดช่องพิมพ์ระหว่างรอ AI
  messageInput.disabled = isBusy;

  // ตอนกำลังตอบ:
  // ซ่อนปุ่มส่ง และแสดงปุ่มหยุด
  sendButton.classList.toggle(
    "hidden",
    isBusy
  );

  stopButton.classList.toggle(
    "hidden",
    !isBusy
  );

  loadingIndicator.classList.toggle(
    "hidden",
    !isBusy
  );
}


// =====================================================
// SEND MESSAGE
// =====================================================

async function sendMessage(message) {

  clearError();

  // แสดงข้อความของผู้ใช้
  appendUserMessage(message);

  // เปลี่ยน UI เป็นสถานะกำลังตอบ
  setBusy(true);

  // สร้าง AbortController
  activeAbortController =
    new AbortController();

  // สร้างพื้นที่สำหรับคำตอบของ AI
  const aiBubble =
    createAiBubble();

  let accumulatedText = "";

  let receivedDone = false;

  try {

    // =================================================
    // CALL BACKEND
    // =================================================

    const response = await fetch(
      "/api/v1/chat/stream",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          message: message
        }),

        signal:
          activeAbortController.signal
      }
    );


    // =================================================
    // CHECK RESPONSE
    // =================================================

    if (
      !response.ok ||
      !response.body
    ) {
      throw new Error(
        `เซิร์ฟเวอร์ตอบกลับด้วยสถานะ ${response.status}`
      );
    }


    // =================================================
    // READ STREAM
    // =================================================

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder("utf-8");

    let buffer = "";


    while (true) {

      const {
        value,
        done
      } = await reader.read();

      if (done) {
        break;
      }


      // แปลงข้อมูลจาก stream
      buffer += decoder.decode(
        value,
        {
          stream: true
        }
      );


      // แยก SSE event
      const events =
        buffer.split("\n\n");

      buffer = events.pop();


      // =================================================
      // PROCESS EVENTS
      // =================================================

      for (
        const rawEvent of events
      ) {

        const dataLine =
          rawEvent
            .split("\n")
            .find(
              (line) =>
                line.startsWith("data:")
            );


        if (!dataLine) {
          continue;
        }


        let payload;


        // =================================================
        // PARSE JSON
        // =================================================

        try {

          payload = JSON.parse(
            dataLine
              .slice("data:".length)
              .trim()
          );

        } catch (err) {

          console.warn(
            "[chat] ข้าม event ที่ parse ไม่ได้:",
            rawEvent
          );

          continue;
        }


        // =================================================
        // AI DELTA
        // =================================================

        if (payload.delta) {

          accumulatedText +=
            payload.delta;

          aiBubble.innerHTML =
            renderMarkdown(
              accumulatedText
            );

          scrollToBottom();
        }


        // =================================================
        // ERROR FROM BACKEND
        // =================================================

        else if (payload.error) {

          showError(
            payload.message ||
            "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ"
          );
        }


        // =================================================
        // STREAM COMPLETE
        // =================================================

        else if (payload.done) {

          receivedDone = true;

          console.log(
            "[chat] stream done"
          );
        }
      }
    }


    // =================================================
    // CHECK STREAM STATUS
    // =================================================

    if (!receivedDone) {

      showError(
        "การเชื่อมต่อถูกตัดกลางทาง กรุณาลองใหม่อีกครั้ง"
      );
    }


    // ถ้าไม่มีคำตอบจาก AI ให้ลบ bubble ออก
    if (!accumulatedText) {

      aiBubble
        .parentElement
        ?.remove();
    }


  } catch (err) {


    // =================================================
    // USER PRESSED STOP
    // =================================================

    if (
      err.name === "AbortError"
    ) {

      console.log(
        "[chat] ผู้ใช้กดหยุดการตอบกลับ"
      );

      showNotice(
        "หยุดการตอบกลับแล้ว"
      );


      // ถ้าไม่มีข้อความเลย ให้ลบ bubble
      if (!accumulatedText) {

        aiBubble
          .parentElement
          ?.remove();
      }


    }

    // =================================================
    // OTHER ERROR
    // =================================================

    else {

      console.error(
        "[chat] sendMessage failed:",
        err
      );

      showError(
        "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่า backend และผู้ให้บริการ AI เปิดอยู่"
      );


      if (!accumulatedText) {

        aiBubble
          .parentElement
          ?.remove();
      }
    }


  } finally {

    // =================================================
    // RESET UI
    // =================================================

    activeAbortController = null;

    setBusy(false);

    messageInput.focus();
  }
}


// =====================================================
// RESET CONVERSATION
// =====================================================

async function resetConversation() {

  newChatButton.disabled = true;

  try {

    const response =
      await fetch(
        "/api/v1/chat/reset",
        {
          method: "POST"
        }
      );


    if (!response.ok) {

      throw new Error(
        `เซิร์ฟเวอร์ตอบกลับด้วยสถานะ ${response.status}`
      );
    }


    // ล้างเฉพาะข้อความ
    chatWindow
      .querySelectorAll(".message")
      .forEach(
        (el) => el.remove()
      );


    clearError();

    showEmptyState();

    messageInput.value = "";

    messageInput.focus();


  } catch (err) {

    console.error(
      "[chat] resetConversation failed:",
      err
    );

    showError(
      "เริ่มบทสนทนาใหม่ไม่สำเร็จ กรุณาลองอีกครั้ง"
    );


  } finally {

    newChatButton.disabled = false;
  }
}


// =====================================================
// CHAT FORM SUBMIT
// =====================================================

chatForm.addEventListener(
  "submit",
  (event) => {

    event.preventDefault();

    const message =
      messageInput.value.trim();


    // ไม่ส่งข้อความว่าง
    if (!message) {
      return;
    }


    // เคลียร์ช่อง input
    messageInput.value = "";


    // ส่งข้อความ
    sendMessage(message);
  }
);


// =====================================================
// STOP BUTTON
// =====================================================

stopButton.addEventListener(
  "click",
  () => {

    activeAbortController?.abort();
  }
);


// =====================================================
// NEW CHAT BUTTON
// =====================================================

newChatButton.addEventListener(
  "click",
  () => {

    resetConversation();
  }
);


// =====================================================
// AUTHOR NAME STYLE
// =====================================================

// สร้าง CSS สำหรับชื่อผู้จัดทำ
const authorStyle =
  document.createElement("style");

authorStyle.textContent = `
  .author-name {
    text-align: center;
    font-size: 13px;
    color: #777;
    padding: 8px 16px;
    font-family: inherit;
    background: transparent;
  }
`;

document.head.appendChild(
  authorStyle
);
```
