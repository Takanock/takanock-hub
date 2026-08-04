import { useEffect, useState } from 'react';
import Head from 'next/head';
import NavBar from '../components/NavBar';
import RequestTypeSelect from '../components/RequestTypeSelect';
import ChatInterface from '../components/ChatInterface';
import ITChat from '../components/ITChat';
import GISChat from '../components/GISChat';
import AutomationChat from '../components/AutomationChat';
import LegalChat from '../components/LegalChat';
import TicketLookup from '../components/TicketLookup';

export default function Home() {
  const [activeView, setActiveView] = useState('assistant');
  const [requestType, setRequestType] = useState('it');

  // main's height is calc(100vh - var(--topbar-height, 67px)) — measure
  // the topbar for real instead of relying solely on the 67px fallback,
  // since its rendered height varies with font metrics/loading.
  useEffect(() => {
    const topbar = document.querySelector('.topbar');
    if (topbar) {
      document.documentElement.style.setProperty('--topbar-height', topbar.offsetHeight + 'px');
    }
  }, []);

  function openIntakeForm(type) {
    setActiveView('request');
    setRequestType(type);
  }

  return (
    <>
      <Head>
        <title>Takanock Assistant Hub</title>
      </Head>

      <NavBar activeView={activeView} onChangeView={setActiveView} />

      <main>
        {/* MODE 1: ASSISTANT */}
        <section id="view-assistant" className={'view' + (activeView === 'assistant' ? ' active' : '')}>
          <ChatInterface onOpenIntakeForm={openIntakeForm} />
        </section>

        {/* MODE 2: SUBMIT A REQUEST */}
        <section id="view-request" className={'view' + (activeView === 'request' ? ' active' : '')}>
          <div className="form-wrap chat-flow-active">
            <div id="request-banner"></div>
            <RequestTypeSelect value={requestType} onChange={setRequestType} />
            <div
              id="it-flow"
              style={{ display: requestType === 'it' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
            >
              <ITChat />
            </div>
            <div
              id="gis-flow"
              style={{ display: requestType === 'gis' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
            >
              <GISChat />
            </div>
            <div
              id="automation-flow"
              style={{ display: requestType === 'automation' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
            >
              <AutomationChat />
            </div>
            <div
              id="legal-flow"
              style={{ display: requestType === 'legal' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
            >
              <LegalChat />
            </div>
          </div>
        </section>

        {/* MODE 3: CHECK MY TICKET */}
        <section id="view-ticket" className={'view' + (activeView === 'ticket' ? ' active' : '')}>
          <TicketLookup />
        </section>
      </main>
    </>
  );
}
