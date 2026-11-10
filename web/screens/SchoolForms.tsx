import { useEffect, useState } from 'react';
import type { Row } from '../api';
import type { Api } from '../api';
import type { Route } from '../routes';
import { clamp, monthOf, firstOf, type Month } from '../dates';
import { ScopePickers, useScope } from '../components/scope';
import { EmptyState, PageHeader, TableSkeleton, localToday, type Status } from '../components/primitives';
import { MonthNav } from '../forms/shared';
import { Sf4Report } from './Sf4';

type Props = { api: Api; me: Row; manager: boolean; setStatus: (s: Status) => void; reload: () => void; token: number; route: Route };

/** A form screen with nothing to show yet, said in the screen's own words. */
const Empty = ({ route, title, body }: { route: Route; title: string; body: string }) => (
  <><PageHeader route={route} /><div className="card"><EmptyState title={title} body={body} /></div></>
);

/** The school's SF4 for a month, the same card Monthly consolidation carries, on a page of its own. */
export function SchoolForm4({ api, me, setStatus, token, route }: Props) {
  const scope = useScope(api, token);
  const [month, setMonth] = useState<Month | null>(null);
  const { year } = scope;
  useEffect(() => { if (year) setMonth(monthOf(clamp(localToday(), String(year.starts_on), String(year.ends_on)))); }, [year?.id]);
  if (scope.years === null) return <><PageHeader route={route} /><div className="card"><TableSkeleton columns={5} /></div></>;
  if (!scope.years.length || !year) return <Empty route={route} title="No school year yet" body="An SF4 belongs to a month of a school year. Create the year first." />;
  return (
    <>
      <PageHeader route={route} />
      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <ScopePickers scope={scope} yearOnly />
            {month ? <MonthNav month={month} setMonth={setMonth} startsOn={String(year.starts_on)} endsOn={String(year.ends_on)} /> : null}
          </div>
        </div>
      </div>
      {month ? <Sf4Report api={api} me={me} year={year} monthOn={firstOf(month)} setStatus={setStatus} auto /> : null}
    </>
  );
}

type Enrolled = Row & { learner: (Row & { id: string }) | null };

/** Every enrollment in one section, paged through; the list writes one access row per page, as every enrollment list does. */
