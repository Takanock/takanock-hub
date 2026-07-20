import { useEffect, useRef, useState } from 'react';
import { autoResizeTextarea, extractReplyText, stripMarkdownForDisplay } from '../lib/chatHelpers';

const SYSTEM_PROMPT = "You are the Takanock assistant. Your job is to route employees to the correct intake form for IT, GIS, and Automation requests, and to tell anyone who asks who to contact for any topic — not just those three. Do not try to solve the problem yourself.\n\n"
  + "Never use bold text, emojis, or any markdown formatting (asterisks, headers, tables, bullet lists, code ticks). Respond in plain conversational text only.\n\n"
  + "The three intake types are:\n"
  + "- IT Help Desk: anything technology related — access, permissions, hardware, software, SharePoint, Slack, email, network, passwords\n"
  + "- GIS Request: anything maps, geospatial, data layers, site assessments, parcels, GIS\n"
  + "- Automation Idea: any process someone wants automated, a tool they wish existed, repetitive work they want eliminated\n\n"
  + "When you identify one of these three request types, respond with a short, warm, natural reply — casual but professional, never robotic — that confirms the request type and tells them what happens next. The form itself renders automatically below your reply, so don't tell them to click a button or describe any UI element. Match this tone exactly:\n"
  + "- GIS: \"Got it — that's a GIS request! Fill out the form below and Jacob will get back to you.\"\n"
  + "- IT: \"Sounds like an IT issue — submit a ticket below and the IT team will pick it up!\"\n"
  + "- Automation: \"This sounds like an automation request! Submit your idea below and Ivan will review it.\"\n\n"
  + "If someone asks who to contact, on any topic, look at the ORG CHART data provided below (if any) and answer with that person's name, title, and email — never guess a name, title, or email beyond what's given to you.\n"
  + "For legal questions, tell them to contact Adam Smith or Kunle Adeyemo.\n"
  + "If the topic isn't legal and isn't covered by the ORG CHART data, say you don't have that contact information rather than guessing.\n\n"
  + "Still route an actual IT, GIS, or Automation request to its intake form as usual — never try to solve the problem yourself, just route it or point to a contact.\n\n"
  + "If you genuinely cannot tell whether someone wants to submit a request or is just asking who to contact, ask them to describe what they need in a bit more detail.";

const ACTION_LABELS = { automation: 'Open Automation Intake Form', gis: 'Open GIS Intake Form', it: 'Open IT Intake Form' };

// Heuristic keyword match against the assistant's reply text, since the
// system prompt instructs Claude to naturally offer the intake form in
// its own words rather than emit a structured signal.
function detectFormAction(replyText) {
  const lower = replyText.toLowerCase();
  if (/automation (idea|intake|request)|automation form/.test(lower)) return 'automation';
  if (/gis (request|intake)|gis form/.test(lower)) return 'gis';
  if (/it (intake|help desk|form|issue|ticket|team)/.test(lower)) return 'it';
  return null;
}

// Removes bracketed placeholders like "[Open GIS Request Form]" from the
// displayed text — the actual button already renders below the bubble via
// detectFormAction, so the bracket text would just be redundant.
function stripFormPlaceholders(text) {
  return text.replace(/\[open[^\]]*form\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}

export default function ChatInterface({ onOpenIntakeForm }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: "Hi, I'm the Takanock Assistant. What do you need help with today? Describe your problem and I'll get you to the right place — or tell you who to ask." }
  ]);
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

  function sendMessage() {
    const text = inputValue.trim();
    if (!text) return;

    setMessages((prev) => [...prev, { role: 'user', text }]);
    const newHistory = [...history, { role: 'user', content: text }];
    setHistory(newHistory);
    setInputValue('');
    setDisabled(true);
    setTyping(true);

    fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: newHistory,
        system: SYSTEM_PROMPT,
        model: 'claude-sonnet-4-6',
        max_tokens: 1000
      })
    })
      .then((r) => r.json())
      .then((data) => {
        setTyping(false);
        const rawReply = extractReplyText(data);
        const actionType = detectFormAction(rawReply);
        const replyText = stripFormPlaceholders(rawReply);
        setHistory((prev) => [...prev, { role: 'assistant', content: replyText }]);
        setMessages((prev) => [...prev, { role: 'assistant', text: replyText, actionType }]);
      })
      .catch(() => {
        setTyping(false);
        setMessages((prev) => [...prev, { role: 'assistant', text: 'Sorry, something went wrong reaching the assistant. Please try again.' }]);
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
    <div className="chat-container">
      <div className="chat-header">
        <h1>Takanock Assistant</h1>
        <p>Describe your problem and I'll get you to the right place — or tell you who to ask.</p>
      </div>
      <div className="chat-messages" ref={messagesRef}>
        {messages.map((m, i) => (
          <div className={'msg-row ' + m.role} key={i}>
            <div className="msg" dangerouslySetInnerHTML={{ __html: stripMarkdownForDisplay(m.text) }} />
            {m.actionType && (
              <div className="msg-actions">
                <button className="action-btn" onClick={() => onOpenIntakeForm(m.actionType)}>
                  {ACTION_LABELS[m.actionType] || 'Open IT Intake Form'}
                </button>
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
  );
}
