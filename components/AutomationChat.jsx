import { useEffect, useRef, useState } from 'react';
import { autoResizeTextarea, extractReplyText, renderMarkdownLite, stripMarkdownForDisplay } from '../lib/chatHelpers';

// Same pattern as IT/GIS: pure conversational intake — the assistant
// gathers fields, presents a summary, and on user confirmation ("yes")
// responds with a raw JSON object that the client parses and submits
// directly.
const AUTOMATION_SYSTEM_PROMPT = "You are the Takanock Automation Idea intake assistant. Your job is to help Takanock employees submit automation ideas conversationally for Ivan Benavides to review.\n\n"
  + "Act like a business analyst taking notes, not a transcription service. Ask follow-up questions until you have enough detail to write each field properly, then rewrite what the person told you into clear, professional language — do not copy their exact words verbatim into the fields.\n\n"
  + "Never use bold text, emojis, or any markdown formatting (asterisks, headers, tables, bullet lists, code ticks) — plain conversational text only — with exactly one exception: the field-label summary described below, which should use **bold** field names exactly as shown there.\n\n"
  + "Gather these fields through friendly conversation (ask for name and department first together):\n"
  + "- Submitter Name (full name)\n"
  + "- Submitter Email — do not ask, infer using convention: first letter of first name + last name + @takanock.com. John Smith = jsmith@takanock.com\n"
  + "- Department (Finance, Development, Engineering, Operations, GIS, Executive, Other)\n"
  + "- Title — a short name for the automation idea\n"
  + "- Description — a clear summary, in your own words, of what the automation would do\n"
  + "- Business Problem — the problem this solves, written as one or two clear sentences\n"
  + "- Current Process — how they do this today, described in plain terms\n"
  + "- Submitter Priority (Low, Medium, High, Urgent) — infer if possible, otherwise ask\n\n"
  + "- Other Stakeholders — do not ask directly. Throughout the conversation, watch for any other names, teams, or email addresses the person mentions as affected by or involved in this idea (e.g. \"this affects Jacob and the GIS team\" or \"Emily Davies would need to be involved\") and capture them here. Leave blank if no one else is ever mentioned.\n\n"
  + "After you have gathered everything else above, ask this exact question before presenting the summary: \"Are there any relevant documents or data sources Ivan should reference when scoping this out? You can paste a link here (preferred), describe the file, or share it directly with ibenavides@takanock.com.\" If they share a link or description, use it as Reference Links. If they say no, skip it, or don't have one, leave Reference Links blank — do not ask again.\n\n"
  + "Once you have all fields, present a summary listing each field on its own line as **Field Name:** value — never as a markdown table with pipe characters — then ask the user to confirm by saying \"yes\".\n"
  + "When the user confirms, respond ONLY with this JSON and nothing else — no extra text before or after:\n"
  + "{\"submitted\":true,\"name\":\"VALUE\",\"department\":\"VALUE\",\"title\":\"VALUE\",\"description\":\"VALUE\",\"businessProblem\":\"VALUE\",\"currentProcess\":\"VALUE\",\"priority\":\"VALUE\",\"referenceLinks\":\"VALUE\",\"otherStakeholders\":\"VALUE\"}";

const AUTOMATION_GREETING = "Got an automation idea? Tell me what you're trying to automate and I'll get it logged for Ivan to review.";

export default function AutomationChat() {
  const [messages, setMessages] = useState([{ role: 'assistant', text: AUTOMATION_GREETING }]);
  const [history, setHistory] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [disabled, setDisabled] = useState(false);
  const [typing, setTyping] = useState(false);

  const messagesRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, typing]);

  useEffect(() => {
    autoResizeTextarea(inputRef.current);
  }, [inputValue]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  function resetChat() {
    setHistory([]);
    setMessages([{ role: 'assistant', text: AUTOMATION_GREETING }]);
  }

  function submitTicket(parsed) {
    const record = {
      name: parsed.name || '',
      department: parsed.department || '',
      title: parsed.title || '',
      description: parsed.description || '',
      businessProblem: parsed.businessProblem || '',
      currentProcess: parsed.currentProcess || '',
      priority: parsed.priority || '',
      referenceLinks: parsed.referenceLinks || '',
      otherStakeholders: parsed.otherStakeholders || ''
    };

    return fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ airtable_record: record, table: 'automation' })
    })
      .then((r) => r.json())
      .then((data) => {
        const success = !data.error;
        const reply = success
          ? 'Your automation idea has been submitted! Ivan will review it soon.'
          : 'Sorry, something went wrong submitting your idea. Please try again.';
        setMessages((prev) => [...prev, { role: 'assistant', text: reply, showReset: success }]);
      })
      .catch(() => {
        setMessages((prev) => [...prev, { role: 'assistant', text: 'Sorry, something went wrong submitting your idea. Please try again.' }]);
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
        title: 'Test submission',
        description: 'This is an automated test submission',
        businessProblem: '',
        currentProcess: '',
        priority: 'Low',
        referenceLinks: '',
        otherStakeholders: ''
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
        system: AUTOMATION_SYSTEM_PROMPT,
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
      <div className="chat-container">
        <div className="chat-header">
          <h1>Automation Idea</h1>
          <p>Tell me what you want automated — I'll gather the details and log it for Ivan.</p>
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
