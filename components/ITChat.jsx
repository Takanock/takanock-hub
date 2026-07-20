import { useEffect, useRef, useState } from 'react';
import { autoResizeTextarea, extractReplyText, renderMarkdownLite, stripMarkdownForDisplay } from '../lib/chatHelpers';

// Matches the existing tak-it-help.vercel.app tool's behavior exactly:
// pure conversational intake — the assistant gathers fields, presents
// a summary, and on user confirmation ("yes") responds with a raw JSON
// object that the client parses and submits directly. No separate
// review form — that tool doesn't have one, so neither does this.
const IT_SYSTEM_PROMPT = "You are the Takanock IT Help Desk intake assistant. Your job is to help Takanock employees submit IT support requests conversationally.\n\n"
  + "Act like a business analyst taking notes, not a transcription service. Ask follow-up questions until you have enough detail to write each field properly, then rewrite what the person told you into clear, professional language — do not copy their exact words verbatim into the fields.\n\n"
  + "Never use bold text, emojis, or any markdown formatting (asterisks, headers, tables, bullet lists, code ticks) — plain conversational text only — with exactly one exception: the field-label summary described below, which should use **bold** field names exactly as shown there.\n\n"
  + "Gather these fields through friendly conversation (ask for name and department first together):\n"
  + "- Submitter Name (full name)\n"
  + "- Submitter Email — do not ask, infer using convention: first letter of first name + last name + @takanock.com. John Smith = jsmith@takanock.com\n"
  + "- Department (Finance, Development, Engineering, Operations, GIS, Executive, Other)\n"
  + "- Request Type (Permissions Issue, Slack, Sharepoint, Hardware Issue, New Dataset, Other) — infer from context, do not ask directly\n"
  + "- Request Description (a detailed description of the issue — see follow-up question requirement below)\n"
  + "- Urgency (Low, Medium, High, Urgent) — infer from context if there are clear signals (e.g. blocked work, a deadline, or something clearly minor and non-blocking). If the user never states or implies an urgency level, default to Medium rather than asking. Only use Low if the context clearly signals a low-priority, non-blocking request — never default to Low just because urgency wasn't mentioned.\n\n"
  + "Follow-up questions: after the user first describes their issue, do not jump straight to a summary. Ask at least one follow-up question to get the specific detail Jacob (IT) needs to resolve the ticket without having to message the person back for more information. Use judgment to pick whichever question is most relevant to what they described, for example:\n"
  + "- The exact error message they're seeing, if any\n"
  + "- What they've already tried\n"
  + "- Who else is affected or needs the same access\n"
  + "- Which system or tool specifically is involved\n"
  + "- When the issue started\n"
  + "Ask only one follow-up question at a time — never stack multiple questions in a single message. Keep asking follow-ups one at a time until you have enough detail for Jacob to act on immediately; a simple, self-explanatory request may only need one, but ambiguous or technical issues may need two or three. Fold everything you learn into the Request Description field so the full context lives in one place.\n\n"
  + "Once you have all fields and enough detail on the issue, present a summary listing each field on its own line as **Field Name:** value — never as a markdown table with pipe characters — then ask the user to confirm by saying \"yes\".\n"
  + "When the user confirms, respond ONLY with this JSON and nothing else — no extra text before or after:\n"
  + "{\"submitted\":true,\"name\":\"VALUE\",\"email\":\"VALUE\",\"department\":\"VALUE\",\"requestType\":\"VALUE\",\"description\":\"VALUE\",\"urgency\":\"VALUE\"}";

const IT_GREETING = "Hi! I'm the Takanock IT Help Desk assistant. Tell me what's going on — I'll gather the details and log a ticket for you. What issue are you running into?";

export default function ITChat() {
  const [messages, setMessages] = useState([{ role: 'assistant', text: IT_GREETING }]);
  const [history, setHistory] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [disabled, setDisabled] = useState(false);
  const [typing, setTyping] = useState(false);

  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, typing]);

  useEffect(() => {
    autoResizeTextarea(inputRef.current);
  }, [inputValue]);

  // Forces a layout reflow on mount, which fixes the input row clipping
  // that only appears before the first message is sent.
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.style.display = 'none';
      void container.offsetHeight; // force reflow
      container.style.display = 'flex';
    }
  }, []);

  useEffect(() => {
    setTimeout(() => {
      if (messagesRef.current) {
        messagesRef.current.scrollTop = 0;
      }
    }, 100);
  }, []);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  function resetChat() {
    setHistory([]);
    setMessages([{ role: 'assistant', text: IT_GREETING }]);
  }

  function submitTicket(parsed) {
    const record = {
      name: parsed.name || '',
      department: parsed.department || '',
      requestType: parsed.requestType || '',
      description: parsed.description || '',
      urgency: parsed.urgency || ''
    };

    return fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ airtable_record: record, table: 'it' })
    })
      .then((r) => r.json())
      .then((data) => {
        const success = !data.error;
        const reply = success
          ? 'Your ticket has been submitted! Jacob from IT will be in touch soon.'
          : 'Sorry, something went wrong submitting your ticket. Please try again.';
        setMessages((prev) => [...prev, { role: 'assistant', text: reply, showReset: success }]);
      })
      .catch(() => {
        setMessages((prev) => [...prev, { role: 'assistant', text: 'Sorry, something went wrong submitting your ticket. Please try again.' }]);
      });
  }

  function sendMessage() {
    const text = inputValue.trim();
    if (!text) return;

    const isFirstMessage = history.length === 0;

    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInputValue('');
    if (inputRef.current) {
      inputRef.current.style.height = '40px';
    }

    // Hidden test mode: typing "/test" as the very first message skips the
    // conversation entirely and submits a placeholder record, to quickly
    // verify Airtable connectivity without a full chat run.
    if (isFirstMessage && text.toLowerCase() === '/test') {
      setDisabled(true);
      submitTicket({
        name: 'Test User',
        department: 'Operations',
        requestType: 'Test submission',
        description: 'This is an automated test submission',
        urgency: 'Low'
      }).then(() => {
        setDisabled(false);
        setTimeout(() => {
          if (inputRef.current) inputRef.current.focus();
        }, 50);
      });
      return;
    }

    const newHistory = [...history, { role: 'user', content: text }];
    setHistory(newHistory);
    setDisabled(true);
    setTyping(true);

    fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: newHistory,
        system: IT_SYSTEM_PROMPT,
        model: 'claude-sonnet-4-6',
        max_tokens: 1000
      })
    })
      .then((r) => r.json())
      .then((data) => {
        setTyping(false);
        const replyText = extractReplyText(data);

        let parsed = null;
        try { parsed = JSON.parse(replyText.trim()); } catch (e) { /* not the final JSON — a normal chat reply */ }

        if (parsed && parsed.submitted === true) {
          return submitTicket(parsed);
        }

        setHistory((prev) => [...prev, { role: 'assistant', content: replyText }]);
        setMessages((prev) => [...prev, { role: 'assistant', text: replyText }]);
      })
      .catch(() => {
        setTyping(false);
        setMessages((prev) => [...prev, { role: 'assistant', text: 'Connection error — please try again.' }]);
      })
      .then(() => {
        setDisabled(false);
        setTimeout(() => {
          if (inputRef.current) inputRef.current.focus();
        }, 50);
      });
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <>
      <div className="chat-container" ref={containerRef}>
        <div className="chat-header">
          <h1>IT Help Desk</h1>
          <p>Tell me what's going on — I'll gather the details and log a ticket for you.</p>
        </div>
        <div className="chat-messages" ref={messagesRef}>
          {messages.map((m, i) => (
            <div className={'msg-row ' + m.role} key={i}>
              <div
                className="msg"
                dangerouslySetInnerHTML={{
                  __html: m.role === 'assistant' ? renderMarkdownLite(m.text) : stripMarkdownForDisplay(m.text)
                }}
              />
              {m.showReset && (
                <div className="msg-actions">
                  <button type="button" className="link-toggle" onClick={resetChat}>Start a new request</button>
                </div>
              )}
            </div>
          ))}
          {typing && (
            <div className="msg-row assistant">
              <div className="msg">
                <span className="typing-dots"><span></span><span></span><span></span></span>
              </div>
            </div>
          )}
        </div>
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="Type a message..."
            rows={1}
            value={inputValue}
            disabled={disabled}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="send-btn" disabled={disabled} onClick={sendMessage}>Send</button>
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: '12px' }}>
        <button type="button" className="link-toggle" onClick={resetChat}>New Request</button>
      </div>
    </>
  );
}
