import { Header } from "../components/Header";
import { PageShell } from "../components/Layout";
import styles from "./TermsPage.module.css";

// Not RequireAuth-gated, same reasoning as RulesPage — a visitor should be
// able to read this before signing up, not just after.
//
// Adapted from a generated boilerplate draft, trimmed to what's actually
// true of Anagrabble: no company entity (solo operator, so no "officers"/
// "partners" language), no user-generated content beyond a display name (so
// no Contributions/Contribution License sections — the boilerplate draft
// self-contradicted on this, opening that section with "the Services does
// not offer users to submit or post content" and then describing a content
// license anyway), no commerce (so no pricing/buying-agent language), and
// no formal arbitration (disproportionate for a free hobby project — courts
// of England and Wales under "Governing law" cover it instead). The
// under-13 children's-privacy line matches the privacy policy's threshold
// rather than the boilerplate's stricter "not a minor" (18+) framing, so the
// two documents don't disagree with each other.

type BodyItem = string | { list: string[] };

const SECTIONS: { title: string; body: BodyItem[] }[] = [
  {
    title: "Agreement to these terms",
    body: [
      'Anagrabble is a hobby project run by an individual, not a company — in these terms, "we," "us," and "our" refer to that operator. By creating an account or otherwise using Anagrabble (the "Services"), you agree to these terms. If you don\'t agree, don\'t use the Services.',
    ],
  },
  {
    title: "What Anagrabble is",
    body: [
      'Anagrabble is a free, real-time multiplayer word game. We may change, add to, or remove features at any time, and we don\'t promise the Services will always be available or error-free, or that your account or stats history will be preserved indefinitely — see "No warranty" below.',
    ],
  },
  {
    title: "Intellectual property",
    body: [
      'We own or license everything that makes up Anagrabble — its code, design, dictionary data, and branding (the "Content"). Subject to your compliance with these terms, we grant you a personal, non-commercial, revocable license to access and use the Services. You may not copy, reproduce, or otherwise exploit the Content for a commercial purpose without our permission.',
    ],
  },
  {
    title: "Your account",
    body: [
      "To play, you need an account, handled through our sign-in provider, Clerk. You're responsible for keeping your credentials to yourself and for what happens under your account. One account per person — don't create accounts to impersonate someone else or to get around a suspension. Anagrabble isn't directed at children under 13, and by using it you represent that you're at least that old.",
    ],
  },
  {
    title: "Acceptable use",
    body: [
      {
        list: [
          "Play fair: no automation, scripting, bots, or exploiting bugs to gain scores or word claims you didn't earn.",
          "No harassing, threatening, or impersonating other players, and no usernames that are abusive or impersonate someone else.",
          "No attempting to bypass account, security, or access restrictions.",
          "No scraping or systematically extracting data from the Services, or using them to build a competing product.",
          "No disrupting or overburdening the Services (load-testing, denial-of-service, excessive automated requests) for anyone else.",
          "No decompiling, reverse engineering, or copying the Services' underlying software, except where the law specifically allows it.",
        ],
      },
    ],
  },
  {
    title: "Feedback",
    body: [
      "If you send us suggestions, bug reports, or other feedback, you agree we can use it to improve Anagrabble without any obligation to credit or compensate you.",
    ],
  },
  {
    title: "Availability and changes",
    body: [
      "We may change, suspend, or discontinue any part of the Services at any time, and we don't guarantee uninterrupted availability — this is a side project, not one with an uptime commitment. We're not liable for loss caused by downtime or a discontinued feature.",
    ],
  },
  {
    title: "No warranty",
    body: [
      "The Services are provided as-is, with no warranties of any kind, express or implied, including fitness for a particular purpose or non-infringement. We don't warrant that the Services will be secure, uninterrupted, or error-free.",
    ],
  },
  {
    title: "Limitation of liability",
    body: [
      "To the extent the law allows, we aren't liable for indirect, incidental, or consequential damages arising from your use of the Services. Since Anagrabble is free to use, our total liability to you for any claim is limited to the amount you've paid us in the past twelve months — which, for a free service, is nothing.",
    ],
  },
  {
    title: "Indemnification",
    body: [
      "You agree to indemnify us against any claim or loss arising from your breach of these terms, your misuse of the Services, or your violation of someone else's rights.",
    ],
  },
  {
    title: "Termination",
    body: [
      "We may suspend or terminate your account at any time, for any reason, including a breach of the acceptable-use rules above. You may stop using the Services and request account deletion at any time — see our privacy policy.",
    ],
  },
  {
    title: "Governing law",
    body: [
      "These terms are governed by the laws of England and Wales, and any dispute arising from them is subject to the exclusive jurisdiction of the courts of England and Wales.",
    ],
  },
  {
    title: "Changes to these terms",
    body: [
      "If these change in a way that matters, we'll update the date below. Continuing to use Anagrabble after a change means you accept the update.",
    ],
  },
  {
    title: "Contact us",
    body: ["Questions about these terms: legal@anagrabble.com."],
  },
];

function SectionBody({ item }: { item: BodyItem }) {
  if (typeof item === "string") {
    return <p className={styles.sectionBody}>{item}</p>;
  }
  return (
    <ul className={styles.sectionList}>
      {item.list.map((entry, i) => (
        <li key={i}>{entry}</li>
      ))}
    </ul>
  );
}

export function TermsPage() {
  return (
    <PageShell>
      <Header />
      <div className={styles.content}>
        <div className={styles.column}>
          <h1 className={styles.title}>Terms of service</h1>
          <p className={styles.updated}>Last updated 27 August 2026</p>
          <div className={styles.sections}>
            {SECTIONS.map((section) => (
              <div key={section.title}>
                <h2 className={styles.sectionTitle}>{section.title}</h2>
                {section.body.map((item, i) => (
                  <SectionBody key={i} item={item} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
