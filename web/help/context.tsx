import { createContext, useContext } from 'react';
import type { Faq } from './types';

/** What the help sheet is asked to show: the current screen's guide, or one answer. */
export type HelpTopic = { screen: true } | { faq: string };

/**
 * The shell's help, reachable from anywhere below it. It is a context, not an
 * import, so the primitives a hundred screens share can offer an explanation
 * without depending on the route table the help is written against.
 */
export const HelpContext = createContext<{
  /** The answer that explains an error code for this reader, if there is one. */
  explain?: (code: string) => Faq | undefined;
  /** Opens help over the page, so nothing typed on it is lost. */
  open?: (topic: HelpTopic) => void;
  /** Starts a tour by its id. */
  tour?: (id: string) => void;
}>({});

export const useHelp = () => useContext(HelpContext);
