import { useState } from 'react';
import type { ScreenProps } from '../routes';
import { Attendance } from './Attendance';
import { Sf2Screen } from './Sf2';

type View = 'register' | 'sf2';
const key = 'edunexus-ui-attendance-view';

/**
 * The day's register and the month's SF2 on one screen, from the group
 * leader's notes of 9 October: an adviser fills the register and checks the
 * form it feeds in the same place. The choice is remembered for the session.
 */
export function AttendanceAndSf2(props: ScreenProps) {
  const [view, setView] = useState<View>(() => {
    try { return sessionStorage.getItem(key) === 'sf2' ? 'sf2' : 'register'; } catch { return 'register'; }
  });
  // The SF2 sends an adviser to the first day it is missing marks for.
  const [startOn, setStartOn] = useState<string | undefined>();
  const choose = (next: View) => {
    setView(next);
    try { sessionStorage.setItem(key, next); } catch { /* a private window keeps no preference */ }
  };
  const views = (
    <div className="segmented page-views" role="tablist" aria-label="The register or its School Form 2" data-tour="att-views">
      {([['register', 'Daily register'], ['sf2', 'School Form 2 (the month)']] as const).map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : undefined} onClick={() => choose(id)}>{label}</button>
      ))}
    </div>
  );
  return view === 'sf2'
    ? <Sf2Screen {...props} views={views} onOpenRegister={day => { setStartOn(day); choose('register'); }} />
    : <Attendance {...props} views={views} startOn={startOn} />;
}
