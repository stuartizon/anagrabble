import { Header } from "../components/Header";
import { PageShell } from "../components/Layout";
import styles from "./PrivacyPage.module.css";

// Not RequireAuth-gated, same reasoning as RulesPage — a visitor should be
// able to read this before signing up, not just after.
//
// Adapted from a generated boilerplate draft, trimmed to what's actually
// true of Anagrabble: no ad tracking/analytics, no third-party data sales,
// no sensitive-category collection, and Clerk as the one real data
// processor. Kept the parts of the boilerplate structure that add genuine
// legal coverage (GDPR/UK/Canada legal bases, US state rights, a real ICO
// complaint route) and cut what didn't apply to a two-data-category hobby
// game (location/GPS, non-Google social logins, business-transaction/
// insurance/next-of-kin carve-outs, employment/education data).

type BodyItem = string | { list: string[] };

const SECTIONS: { title: string; body: BodyItem[] }[] = [
  {
    title: "What information we collect",
    body: [
      "Account information, via Clerk (our sign-in provider): your name, email address, and password. If you sign in with Google instead, we receive the name, email, and profile photo Google shares as part of that sign-in.",
      "Gameplay data, which we generate and store ourselves in our own database: the games you've played, words you've claimed or stolen, scores, and timestamps.",
      "Basic technical logs — IP address, browser type, and request timestamps — that our infrastructure records automatically for security and to diagnose problems. We don't turn this into a profile of you, and we don't run analytics or advertising trackers.",
      "We don't collect sensitive information (health, race, religion, biometric data, and the like), and we don't collect anything about you from third parties beyond what Google passes along if you choose to sign in that way.",
    ],
  },
  {
    title: "How we use your information",
    body: [
      {
        list: [
          "Create and maintain your account, and let you sign in.",
          "Run gameplay: resolve turns and word claims, keep score, and maintain your stats history.",
          "Detect abuse and prevent fraud.",
          "Comply with the law, where we're legally required to.",
        ],
      },
      "We don't use your information for marketing, profiling, or advertising of any kind.",
    ],
  },
  {
    title: "Legal bases for processing (EEA, UK, and Canada)",
    body: [
      'If you\'re in the EEA, UK, or Canada, data protection law requires us to name the legal basis for processing your information. We rely on: performance of a contract (providing the game you signed up to play), your consent (given when you create an account), and legitimate interests (keeping the service secure and working). You can withdraw consent at any time by contacting us — see "Contact us" below.',
    ],
  },
  {
    title: "When and with whom we share information",
    body: [
      {
        list: [
          "Clerk, our authentication provider, which holds your account credentials on our behalf and is bound by its own privacy policy as our data processor.",
          "If legally compelled — a court order, subpoena, or similar legal process.",
          "If Anagrabble is ever sold or transferred, account and gameplay data would transfer as part of that, under the same commitments as this notice.",
        ],
      },
      "We don't sell, rent, or share your information with advertisers, and we don't have advertising partners.",
    ],
  },
  {
    title: "Cookies",
    body: [
      "The only cookie we set is Clerk's session cookie, which keeps you signed in between visits. There are no advertising or analytics cookies, and nothing tracks you across other sites.",
    ],
  },
  {
    title: "Signing in with Google",
    body: [
      "If you choose to sign in with Google rather than a password, we receive your name, email address, and profile photo from Google. We don't control, and aren't responsible for, Google's own handling of your information — see Google's privacy policy for that.",
    ],
  },
  {
    title: "How long we keep your information",
    body: [
      "We keep your information for as long as you have an account. Email privacy@anagrabble.com to request deletion — we'll remove your Clerk account and disassociate your gameplay history from your identity, except where we need to briefly retain something to prevent fraud or meet a legal obligation.",
    ],
  },
  {
    title: "Children's privacy",
    body: [
      "Anagrabble isn't directed at children under 13, and we don't knowingly collect information from them. If we learn a child under 13 has created an account, we'll deactivate it and delete their data. Contact privacy@anagrabble.com if you believe this has happened.",
    ],
  },
  {
    title: "Your privacy rights",
    body: [
      "Depending on where you live, you may have the right to access, correct, delete, or obtain a copy of your personal information, to restrict or object to our processing of it, and to withdraw consent at any time. To exercise any of these, email privacy@anagrabble.com.",
      "If you're in the UK and unhappy with how we've handled a complaint, you can refer it to the Information Commissioner's Office: ico.org.uk/make-a-complaint, helpline 0303 123 1113. If you're in the EEA, you can complain to your local data protection authority; in Switzerland, to the Federal Data Protection and Information Commissioner.",
    ],
  },
  {
    title: "Do-not-track signals",
    body: [
      "We don't use tracking technologies beyond Clerk's session cookie, so a browser's do-not-track signal doesn't change anything we do — there's nothing to opt out of.",
    ],
  },
  {
    title: "US state privacy rights",
    body: [
      "If you're a US resident, state privacy laws may give you the right to know what we collect, access it, correct it, delete it, or opt out of its sale or use in targeted advertising. Of the categories these laws define, we only collect identifiers (name, email address) — nothing in the biometric, financial, geolocation, employment, education, or behavioral-profiling categories. We don't sell personal information or use it for targeted advertising, so there's nothing to opt out of on that front. To exercise any of these rights, email privacy@anagrabble.com.",
    ],
  },
  {
    title: "Changes to this notice",
    body: [
      "If this changes in a way that matters, we'll update the date below. Continuing to use Anagrabble after a change means you accept the update.",
    ],
  },
  {
    title: "Contact us",
    body: ["Questions, requests, or complaints about this notice: privacy@anagrabble.com."],
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

export function PrivacyPage() {
  return (
    <PageShell>
      <Header />
      <div className={styles.content}>
        <div className={styles.column}>
          <h1 className={styles.title}>Privacy policy</h1>
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
