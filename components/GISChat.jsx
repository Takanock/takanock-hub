import { useEffect, useMemo, useRef, useState } from 'react';
import { autoResizeTextarea, extractReplyText, renderMarkdownLite, stripMarkdownForDisplay } from '../lib/chatHelpers';

const GIS_GREETING = "Hi! I'm the Takanock GIS Request assistant. Tell me what you need — a new map, a new data source, presentation support, or something else — and I'll gather the details for Jacob's team.";

export default function GISChat() {
  // Computed once (not per-render) — same as the original, which computed
  // it once at page load, not on every keystroke.
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  // Same pattern as the IT Help Desk: pure conversational intake — the
  // assistant gathers fields, presents a summary, and on user confirmation
  // ("yes") responds with a raw JSON object that the client parses and
  // submits directly. No review form, no attachment upload — Requester
  // Email is inferred the same way IT infers it.
  const GIS_SYSTEM_PROMPT = useMemo(() => (
    "You are the Takanock GIS Request intake assistant. Your job is to help Takanock employees submit GIS requests conversationally for Jacob Paul's team.\n\n"
    + "Never use bold text, emojis, or any markdown formatting (asterisks, headers, tables, bullet lists, code ticks) — plain conversational text only — with exactly one exception: the field-label summary described below, which should use **bold** field names exactly as shown there.\n\n"
    + "Gather these fields through friendly conversation (ask for name first):\n"
    + "- Requester Name (full name)\n"
    + "- Requester Email — do not ask, infer using convention: first letter of first name + last name + @takanock.com. John Smith = jsmith@takanock.com\n"
    + "- Project — which project this relates to, if any (e.g. Baccara, Tallmadge, Hale), or none\n"
    + "- Request Type (New map, New data source, Presentation support, Other) — infer from context if possible, otherwise ask\n"
    + "- Description — a clear, detailed description of what they need; this is the primary field Jacob will read\n"
    + "- New Data Source Needed — true only if the conversation indicates a new external data source (e.g. a KMZ from a gas company) needs to be incorporated\n"
    + "- Presentation Date — only if Request Type is Presentation support and mentioned\n"
    + "- Finalize By Date — the date they need a reviewable draft/deliverable by, if mentioned\n"
    + "- Priority (High, Medium, Low) — infer if possible, otherwise ask\n\n"
    + "Keep the description open-ended and detailed rather than steering to rigid categories. Ask one or two questions at a time, don't interrogate.\n\n"
    + "When converting Presentation Date or Finalize By Date to YYYY-MM-DD format, if the requester doesn't mention a year, assume the current year, " + currentYear + " (e.g. \"July 20\" becomes \"" + currentYear + "-07-20\"). Only use a different year if the requester explicitly states one.\n\n"
    + "After you have gathered everything else above, ask this exact question before wrapping up: \"Do you have any relevant files? If so, paste a SharePoint or OneDrive link and I'll include it. If not, you can send files directly to jpaul@takanock.com after submitting.\" If they share a link, use it as the Presentation Link. If they say no, skip it, or don't have one, leave Presentation Link blank — do not ask again.\n\n"
    + "Once you have all fields, present a summary listing each field on its own line as **Field Name:** value — never as a markdown table with pipe characters — then ask the user to confirm by saying \"yes\".\n"
    + "When the user confirms, respond ONLY with this JSON and nothing else — no extra text before or after:\n"
    + "{\"submitted\":true,\"requesterName\":\"VALUE\",\"project\":\"VALUE\",\"requestType\":\"VALUE\",\"description\":\"VALUE\",\"newDataSourceNeeded\":true,\"presentationLink\":\"VALUE\",\"presentationDate\":\"VALUE\",\"finalizeByDate\":\"VALUE\",\"priority\":\"VALUE\"}"
  ), [currentYear]);

  const [messages, setMessages] = useState([{ role: 'assistant', text: GIS_GREETING }]);
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
    setMessages([{ role: 'assistant', text: GIS_GREETING }]);
  }

  function submitTicket(parsed) {
    const record = {
      requesterName: parsed.requesterName || '',
      project: parsed.project || '',
      requestType: parsed.requestType || '',
      description: parsed.description || '',
      newDataSourceNeeded: parsed.newDataSourceNeeded === true,
      presentationLink: parsed.presentationLink || '',
      presentationDate: parsed.presentationDate || '',
      finalizeByDate: parsed.finalizeByDate || '',
      priority: parsed.priority || ''
    };

    return fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ airtable_record: record, table: 'gis' })
    })
      .then((r) => r.json())
      .then((data) => {
        const success = !data.error;
        const reply = success
          ? 'Your GIS request has been submitted! Jacob will be in touch soon.'
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
        project: '',
        requestType: 'Test submission',
        description: 'This is an automated test submission',
        newDataSourceNeeded: false,
        presentationLink: '',
        presentationDate: '',
        finalizeByDate: '',
        priority: 'Low'
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
        system: GIS_SYSTEM_PROMPT,
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
          <h1>GIS Request</h1>
          <p>Tell me what you need — I'll gather the details and submit it for Jacob's team.</p>
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
