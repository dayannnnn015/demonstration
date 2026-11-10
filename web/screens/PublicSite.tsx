import { useEffect, useState } from 'react';
import type { Api, Row } from '../api';
import { message, query } from '../api';
import type { Route } from '../routes';
import { Sheet } from '../components/overlay';
import { Icon } from '../components/icons';
import {
  Badge, Button, Callout, Cell, Editor, EmptyState, PageHeader, StatusLine, Table, TableSkeleton, idle, type Field, type Status,
} from '../components/primitives';

type Props = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };
type Announcement = {
  id: string; kind: 'news' | 'event' | 'advisory'; title: string; summary: string; body: string; event_on: string | null; event_ends_on: string | null;
  event_time: string | null; venue: string | null; pinned: boolean; status: 'draft' | 'published' | 'archived'; published_at: string | null; version: number; updated_at: string;
  updated_by: string | null;
};
type Question = { id: string; question: string; answer: string; position: number; status: 'draft' | 'published' | 'archived'; published_at: string | null; version: number; updated_at: string; updated_by: string | null };
type Settings = { tagline: string | null; about: string | null; mission: string | null; vision: string | null; phone: string | null; email: string | null;
  office_hours: string | null; facebook_url: string | null; version: number };

const kindWord = { news: 'News', event: 'Event', advisory: 'Advisory' } as const;
const statusTone = { draft: 'neutral', published: 'good', archived: 'attention' } as const;
const statusWord = { draft: 'Draft', published: 'On the front page', archived: 'Archived' } as const;

const noticeFields: Field[] = [
  { key: 'kind', label: 'Kind', options: [['news', 'News'], ['event', 'Event (has a date)'], ['advisory', 'Advisory']] },
  { key: 'title', label: 'Title', maxLength: 160, wide: true },
  { key: 'summary', label: 'Summary', maxLength: 300, wide: true, hint: 'One or two sentences. Shown in lists and at the top of the notice.' },
  { key: 'body', label: 'Full notice', type: 'textarea', optional: true, wide: true, hint: 'Plain text. Leave a blank line between paragraphs.' },
  { key: 'event_on', label: 'Event date', type: 'date', optional: true, hint: 'Events only.' },
  { key: 'event_ends_on', label: 'Last day, if longer', type: 'date', optional: true },
  { key: 'event_time', label: 'Time', optional: true, maxLength: 60, hint: 'For example 1:30 PM to 3:00 PM.' },
  { key: 'venue', label: 'Where', optional: true, maxLength: 120 },
  { key: 'pinned', label: 'Pin to the top', options: [['false', 'No'], ['true', 'Yes, show it first']] },
  { key: 'reason', label: 'Reason for the change', wide: true, maxLength: 500 },
];

const settingFields: Field[] = [
  { key: 'tagline', label: 'Tagline', optional: true, maxLength: 200, wide: true, hint: 'The line under the school’s name on the front page.' },
  { key: 'about', label: 'About the school', type: 'textarea', optional: true, wide: true, hint: 'A short introduction. Leave a blank line between paragraphs.' },
  { key: 'mission', label: 'Mission', type: 'textarea', optional: true, wide: true },
  { key: 'vision', label: 'Vision', type: 'textarea', optional: true, wide: true },
  { key: 'phone', label: 'Phone', optional: true, maxLength: 60 },
  { key: 'email', label: 'E-mail', type: 'email', optional: true },
  { key: 'office_hours', label: 'Office hours', optional: true, maxLength: 120, hint: 'For example Monday to Friday, 7:30 AM to 4:30 PM.' },
  { key: 'facebook_url', label: 'Facebook page', type: 'url', optional: true, hint: 'The school’s own page, shown on the front page as a way to reach the school. The full address, starting https://www.facebook.com/' },
  { key: 'reason', label: 'Reason for the change', wide: true, maxLength: 500 },
];

const questionFields: Field[] = [
  { key: 'question', label: 'Question', maxLength: 200, wide: true, hint: 'As a parent or guardian would ask it, on one line.' },
  { key: 'answer', label: 'Answer', type: 'textarea', wide: true, hint: 'The school’s own answer. Leave a blank line between paragraphs.' },
  { key: 'position', label: 'Order on the page', type: 'number', min: 1, max: 999, hint: 'Lower numbers come first. Questions with the same number keep the order they were published in.' },
  { key: 'reason', label: 'Reason for the change', wide: true, maxLength: 500 },
];
const asQuestion = (data: Record<string, unknown>) => ({ question: data.question, answer: data.answer, position: data.position, reason: data.reason });

const asNotice = (data: Record<string, unknown>) => ({
  kind: data.kind, title: data.title, summary: data.summary, body: data.body ?? '', event_on: data.event_on, event_ends_on: data.event_ends_on,
  event_time: data.event_time, venue: data.venue, pinned: data.pinned === 'true', reason: data.reason,
});

/**
 * What the school's public front page says: announcements, events and
 * advisories written as drafts and published by the principal or the
 * administrative officer, and the school's tagline, introduction and contact
 * details. The front page shows only what is published here.
 */
export function PublicSite({ api, setStatus, token, route }: Props) {
  const [tab, setTab] = useState<'notices' | 'faqs' | 'details'>('notices');
  const [archived, setArchived] = useState(false);
  const [data, setData] = useState<{ items: Announcement[]; settings: Settings } | null>(null);
  const [failed, setFailed] = useState('');
  const [writing, setWriting] = useState(false);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [sheetStatus, setSheetStatus] = useState<Status>(idle);
  const [tick, setTick] = useState(0);
  const reload = () => setTick(t => t + 1);

  useEffect(() => {
    setFailed('');
    void api<{ items: Announcement[]; settings: Settings }>(`/announcements${query({ archived: archived ? 'true' : undefined })}`)
      .then(setData).catch(error => setFailed(message(error)));
  }, [api, archived, token, tick]);

  useEffect(() => {
    if (tab !== 'faqs') return;
    void api<{ items: Question[] }>(`/site-faqs${query({ archived: archived ? 'true' : undefined })}`)
      .then(r => setQuestions(r.items)).catch(error => setFailed(message(error)));
  }, [api, tab, archived, token, tick]);
  const actOn = (q: Question, action: 'publish' | 'unpublish' | 'archive', reason: string) =>
    api(`/site-faqs/${q.id}/status`, 'POST', { version: q.version, action, reason }).then(() => { reload(); });

  const act = (a: Announcement, action: 'publish' | 'unpublish' | 'archive', reason: string) =>
    api(`/announcements/${a.id}/status`, 'POST', { version: a.version, action, reason }).then(() => { reload(); });

  return (
    <>
      <PageHeader route={route} actions={<>
        <a className="btn secondary" href="/" target="_blank" rel="noopener"><Icon name="forward" size={15} />View the front page</a>
        <button type="button" className="btn" onClick={() => { setSheetStatus(idle); setWriting(true); }} data-tour="site-write"><Icon name="plus" size={15} />Write an announcement</button>
      </>} />
      <div className="card">
        <div className="card-head">
          <div className="segmented" role="tablist" aria-label="Front page" data-tour="site-tabs">
            <button type="button" role="tab" aria-selected={tab === 'notices'} className={tab === 'notices' ? 'active' : undefined} onClick={() => setTab('notices')}>Announcements and events</button>
            <button type="button" role="tab" aria-selected={tab === 'faqs'} className={tab === 'faqs' ? 'active' : undefined} onClick={() => setTab('faqs')}>Questions for parents</button>
            <button type="button" role="tab" aria-selected={tab === 'details'} className={tab === 'details' ? 'active' : undefined} onClick={() => setTab('details')}>School details</button>
          </div>
          {tab === 'faqs' ? <button type="button" className="btn secondary" onClick={() => { setSheetStatus(idle); setAsking(true); }}><Icon name="plus" size={15} />Write a question</button> : null}
          {tab === 'notices' || tab === 'faqs' ? (
            <label className="check-line">
              <input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />
              <span>Show archived</span>
            </label>
          ) : null}
        </div>
        {failed ? <div className="card-body"><Callout tone="stopped" title="The front page’s records could not be read">{failed}</Callout></div> : null}
        {!data && !failed ? <div className="card-body"><TableSkeleton columns={4} /></div> : null}
        {data && tab === 'notices' ? (
          <Table
            rows={data.items}
            rowKey={a => a.id}
            empty={<EmptyState title="No announcements yet" body="Write the first one. It stays a draft, seen only here, until you publish it." />}
            columns={[
              { header: 'Announcement', cell: a => <Cell title={<>{a.title}{a.pinned ? <> <Badge tone="info">Pinned</Badge></> : null}</>} meta={a.summary.length > 90 ? `${a.summary.slice(0, 88)}…` : a.summary} /> },
              { header: 'Kind', cell: a => kindWord[a.kind] },
              { header: 'Date', cell: a => <span className="mono">{a.kind === 'event' ? a.event_on : a.published_at ? new Date(a.published_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) : 'Not published'}</span> },
              { header: 'State', cell: a => <Badge tone={statusTone[a.status]}>{statusWord[a.status]}</Badge> },
            ]}
            detailLabel="Edit"
            detail={a => (a.status === 'archived' ? (
              <p className="muted">An archived announcement is kept as it was, for the record. Write a new one instead.</p>
            ) : (
              <>
                <div className="form-actions sheet-tools notice-actions">
                  {a.status === 'draft' ? (
                    <Button label="Publish on the front page" variant="primary" setStatus={setStatus} confirmTitle={`Publish “${a.title}”?`}
                      confirm="Anyone who opens the school’s front page will see it, without signing in." confirmLabel="Publish"
                      onRun={async () => { await act(a, 'publish', 'Published on the school’s front page.'); setStatus({ text: 'Published on the front page. It can take a minute to appear there.', kind: 'done' }); }} />
                  ) : (
                    <Button label="Take it off the front page" setStatus={setStatus} confirmTitle={`Take “${a.title}” down?`}
                      confirm="It goes back to being a draft that only staff can see. You can publish it again." confirmLabel="Take it down"
                      onRun={async () => { await act(a, 'unpublish', 'Taken off the school’s front page.'); setStatus({ text: 'Taken off the front page. It can take a minute to disappear there.', kind: 'done' }); }} />
                  )}
                  <Button label="Archive" variant="danger" setStatus={setStatus} confirmTitle={`Archive “${a.title}”?`}
                    confirm="It leaves the front page and can never be edited or published again. It stays on record." confirmLabel="Archive"
                    onRun={async () => { await act(a, 'archive', 'Archived; no longer current.'); setStatus({ text: 'Archived.', kind: 'done' }); }} />
                </div>
                <Editor fields={noticeFields} submitLabel="Save changes" setStatus={setStatus} onSaved={reload}
                  initial={{ ...a, pinned: String(a.pinned), reason: a.status === 'published' ? 'Corrected the published notice.' : 'Edited the draft.' }}
                  onSubmit={values => api(`/announcements/${a.id}`, 'PATCH', { ...asNotice(values), version: a.version })} />
                <p className="card-note">Last changed by {a.updated_by ?? 'a staff member'}. Every change is kept with its reason.</p>
              </>
            ))}
          />
        ) : null}
        {tab === 'faqs' && !questions && !failed ? <div className="card-body"><TableSkeleton columns={3} /></div> : null}
        {tab === 'faqs' && questions ? (
          <>
            <div className="card-body"><p className="card-note">Questions parents and guardians ask, answered in the school’s own words, on the front page’s <b>Questions</b> page. EDUNEXUS supplies none: the page shows only what you publish here.</p></div>
            <Table
              rows={questions}
              rowKey={q => q.id}
              empty={<EmptyState title="No questions yet" body="Write the first one. It stays a draft, seen only here, until you publish it." />}
              columns={[
                { header: 'Question', cell: q => <Cell title={q.question} meta={q.answer.length > 90 ? `${q.answer.slice(0, 88)}…` : q.answer} /> },
                { header: 'Order', cell: q => <span className="mono">{q.position}</span> },
                { header: 'State', cell: q => <Badge tone={statusTone[q.status]}>{statusWord[q.status]}</Badge> },
              ]}
              detailLabel="Edit"
              detail={q => (q.status === 'archived' ? (
                <p className="muted">An archived question is kept as it was, for the record. Write a new one instead.</p>
              ) : (
                <>
                  <div className="form-actions sheet-tools notice-actions">
                    {q.status === 'draft' ? (
                      <Button label="Publish on the front page" variant="primary" setStatus={setStatus} confirmTitle="Publish this question?"
                        confirm="Anyone who opens the school’s front page will see it and its answer, without signing in." confirmLabel="Publish"
                        onRun={async () => { await actOn(q, 'publish', 'Published on the school’s front page.'); setStatus({ text: 'Published on the front page. It can take a minute to appear there.', kind: 'done' }); }} />
                    ) : (
                      <Button label="Take it off the front page" setStatus={setStatus} confirmTitle="Take this question down?"
                        confirm="It goes back to being a draft that only staff can see. You can publish it again." confirmLabel="Take it down"
                        onRun={async () => { await actOn(q, 'unpublish', 'Taken off the school’s front page.'); setStatus({ text: 'Taken off the front page. It can take a minute to disappear there.', kind: 'done' }); }} />
                    )}
                    <Button label="Archive" variant="danger" setStatus={setStatus} confirmTitle="Archive this question?"
                      confirm="It leaves the front page and can never be edited or published again. It stays on record." confirmLabel="Archive"
                      onRun={async () => { await actOn(q, 'archive', 'Archived; no longer current.'); setStatus({ text: 'Archived.', kind: 'done' }); }} />
                  </div>
                  <Editor fields={questionFields} submitLabel="Save changes" setStatus={setStatus} onSaved={reload}
                    initial={{ ...q, position: String(q.position), reason: q.status === 'published' ? 'Corrected the published answer.' : 'Edited the draft.' }}
                    onSubmit={values => api(`/site-faqs/${q.id}`, 'PATCH', { ...asQuestion(values), version: q.version })} />
                  <p className="card-note">Last changed by {q.updated_by ?? 'a staff member'}. Every change is kept with its reason.</p>
                </>
              ))}
            />
          </>
        ) : null}
        {data && tab === 'details' ? (
          <div className="card-body">
            <p className="card-note">What the front page says about the school. Leave a field empty and the front page leaves it out; it never fills one in. The name, School ID and address come from <a href="#/school">School profile</a>.</p>
            <Editor fields={settingFields} submitLabel="Save the details" setStatus={setStatus} onSaved={reload}
              initial={{ ...data.settings, reason: 'Updated the school’s front-page details.' }}
              onSubmit={values => api('/site-settings', 'PATCH', { ...values, version: data.settings.version })} />
          </div>
        ) : null}
      </div>
      {asking ? (
        <Sheet title="Write a question" note="Saved as a draft. Publish it from the list when it is ready." wide onClose={() => setAsking(false)}>
          <StatusLine status={sheetStatus} />
          <Editor fields={questionFields} submitLabel="Save as a draft" setStatus={setSheetStatus}
            initial={{ position: '100', reason: 'Written for the school’s front page.' }}
            onSubmit={values => api('/site-faqs', 'POST', asQuestion(values))}
            onSaved={() => { setAsking(false); reload(); setStatus({ text: 'Saved as a draft. Publish it when it is ready.', kind: 'done' }); }} />
        </Sheet>
      ) : null}
      {writing ? (
        <Sheet title="Write an announcement" note="Saved as a draft. Publish it from the list when it is ready." wide onClose={() => setWriting(false)}>
          <StatusLine status={sheetStatus} />
          <Editor fields={noticeFields} submitLabel="Save as a draft" setStatus={setSheetStatus}
            initial={{ kind: 'news', pinned: 'false', reason: 'Written for the school’s front page.' }}
            onSubmit={values => api('/announcements', 'POST', asNotice(values))}
            onSaved={() => { setWriting(false); reload(); setStatus({ text: 'Saved as a draft. Publish it when it is ready.', kind: 'done' }); }} />
        </Sheet>
      ) : null}
    </>
  );
}
