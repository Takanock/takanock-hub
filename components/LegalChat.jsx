import { useEffect, useRef, useState } from 'react';
import { autoResizeTextarea, extractReplyText, stripMarkdownForDisplay } from '../lib/chatHelpers';

// Same pattern as IT/GIS/Automation: pure conversational intake — the
// assistant gathers fields, presents a summary, and on user confirmation
// ("yes") responds with a raw JSON object that the client parses and
// submits directly. Unlike IT/GIS/Automation, the summary here stays
// plain text (no bold field labels) per spec.
const LEGAL_SYSTEM_PROMPT = "You are the Takanock Legal Intake assistant. Your job is to collect the details of a legal request and submit it to Adam Smith and Kunlai for review. Be conversational and professional — never robotic.\n\n"
  + "Never use bold text, emojis, or markdown formatting. Plain conversational text only.\n\n"
  + "Collect these fields in a natural conversation:\n"
  + "- Requester Name (full name)\n"
  + "- Requester Email — do not ask, infer using convention: first letter of first name + last name + @takanock.com. John Smith = jsmith@takanock.com\n"
  + "- Department (Finance, Development, Engineering, Operations, GIS, Executive, Other)\n"
  + "- Request Type (Contract Review, NDA, Offer Letter, Board Consent, Other)\n"
  + "- Project (Baccara, Tallmadge, Connemara, Hale, Pacara, Glendale, Koneman, or N/A)\n"
  + "- Description (what specifically is needed)\n"
  + "- Counterparty (the other company or person involved, if applicable)\n"
  + "- Urgency (Low, Medium, High, Urgent) — default to Medium if not specified\n"
  + "- Document Link — ask: \"Do you have any relevant documents? Paste a SharePoint link here if so.\" If they share a link, use it. If they say no, skip it, or don't have one, leave Document Link blank — do not ask again.\n\n"
  + "Once you have all fields, present a plain text summary with field labels followed by values, one per line — no bold, no markdown table — then ask the user to confirm by saying \"yes\".\n"
  + "When the user confirms, respond ONLY with this JSON and nothing else — no extra text before or after:\n"
  + "{\"submitted\":true,\"requesterName\":\"VALUE\",\"department\":\"VALUE\",\"requestType\":\"VALUE\",\"project\":\"VALUE\",\"description\":\"VALUE\",\"counterparty\":\"VALUE\",\"urgency\":\"VALUE\",\"documentLink\":\"VALUE\"}";

const LEGAL_GREETING = "Hi! I can help you submit a legal request to Adam and Kunlai. What do you need help with?";

export default function LegalChat() {
  const [messages, setMessages] = useState([{ role: 'assistant', text: LEGAL_GREETING }]);
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
    setMessages([{ role: 'assistant', text: LEGAL_GREETING }]);
  }

  function submitTicket(parsed) {
    const record = {
      requesterName: parsed.requesterName || '',
      department: parsed.department || '',
      requestType: parsed.requestType || '',
      project: parsed.project || '',
      description: parsed.description || '',
      counterparty: parsed.counterparty || '',
      urgency: parsed.urgency || '',
      documentLink: parsed.documentLink || ''
    };

    return fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ airtable_record: record, table: 'legal' })
    })
      .then((r) => r.json())
      .then((data) => {
        const success = !data.error;
        const reply = success
          ? 'Your legal request has been submitted. Adam and Kunlai will be in touch soon.'
          : 'Sorry, something went wrong submitting your request. Please try again.';
        setMessages((prev) => [...prev, { role: 'assistant', text: reply, showReset: success }]);
      })
      .catch(() => {
        setMessages((prev) => [...prev, { role: 'assistant', text: 'Sorry, something went wrong submitting your request. Please try again.' }]);
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
        requesterName: 'Test User',
        department: 'Operations',
        requestType: 'Other',
        project: 'N/A',
        description: 'This is an automated test submission',
        counterparty: '',
        urgency: 'Low',
        documentLink: ''
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
        system: LEGAL_SYSTEM_PROMPT,
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
          <h1>Legal Intake</h1>
          <p>Tell me what you need — I'll gather the details and submit it to Adam and Kunlai.</p>
        </div>
        <div className="chat-messages" ref={messagesRef}>
          {messages.map((m, i) => (
            <div className={'msg-row ' + m.role} key={i}>
              <div className="msg" dangerouslySetInnerHTML={{ __html: stripMarkdownForDisplay(m.text) }} />
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
