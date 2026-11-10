import { Callout } from '../components/primitives';

/**
 * An honest placeholder. Every module the school will eventually use appears in
 * the navigation, so a staff member can see the shape of the finished system
 * during a walkthrough instead of guessing what is missing. Each one states
 * what the screen will do, what already works behind it, and — where it
 * applies — which school decision it is waiting on.
 *
 * The two are worth telling apart. "Not built yet" is our backlog; "waiting on
 * the school" is a gate, and approximating it with a sensible default is how a
 * wrong rule ends up on a real report card.
 */
export function Upcoming({ summary, detail, blocked }: { summary: string; detail: string; blocked?: string | undefined }) {
  return (
    <>
      <div className="card">
        <div className="planned">
          <span className="planned-mark" aria-hidden="true" />
          <div>
            <h2>{summary}</h2>
            <p>{detail}</p>
          </div>
        </div>
      </div>
      {blocked
        ? <Callout tone="attention" title="Waiting on the school">{blocked}</Callout>
        : <Callout tone="info" title="Not built yet">The workflow behind this screen already exists in the API and is covered by tests. Only the interface is outstanding.</Callout>}
    </>
  );
}
