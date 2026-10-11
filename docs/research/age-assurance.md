# Regional age-assurance laws and the Declared Age Range API for hopon

Research for [#53](https://github.com/chengchao/hopon/issues/53) (found while researching [#41](https://github.com/chengchao/hopon/issues/41); follows the 13+ decision in [#51](https://github.com/chengchao/hopon/issues/51)). Researched 2026-10-10.

**Question:** Which regions impose app-store age-assurance duties that reach hopon, and from when? What does each law ask of the developer, as opposed to the app store? What does Apple provide (Declared Age Range, PermissionKit, server notifications), and how do we call it from Expo? What are hopon's options for under-13s and 13–17s?

**Short answer:** Any US launch is in scope today. App Store availability is chosen per country, not per state ([App Store Connect Help](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-for-your-app-on-the-app-store)), and **Texas SB 2420** has been enforceable since the Fifth Circuit stayed the injunction on June 4, 2026 ([order](https://www.ca5.uscourts.gov/opinions/pub/25/25-51073-CV0.pdf)). Apple applies it to new Texas Apple Accounts from that date ([Apple](https://developer.apple.com/news/?id=sg176nne)). The other US laws come later. **Alabama** and **California** start on Jan 1, 2027. **Utah** starts on May 6, 2027, a year later than its original date. **Louisiana** starts on July 1, 2027, also a year late. Outside the US, Apple names **Brazil** (in force since Mar 17, 2026), **Australia** (an under-16 social media ban since Dec 10, 2025) and **Singapore**.

The US app-store laws share one model. The **store** verifies age and gets parental consent for downloads. The **developer** must:

- read the store's age category for each user;
- tell the store before a "significant change";
- use the age data only for age-related restrictions and compliance, and never share it;
- not enforce its terms against a minor without verified parental consent.

Relying in good faith on the store's signal is a safe harbor. None of the laws makes hopon block 13–17s. What the developer does with the age range is mostly its own call, within the 13+ rating it already declared.

Apple's tools cover all of this. The **Declared Age Range** framework (iOS 26+) returns the age range and, from iOS 26.4, which regulatory features apply to this user. **PermissionKit**'s `SignificantAppUpdateTopic` (iOS 26.2+) handles parental consent for significant changes. A `RESCIND_CONSENT` **App Store Server Notification** reports revoked consent; Apple itself stops the app from launching. In Apple's words, "developers are responsible for their own age restrictions" and, where required by law, "you must check the age of the people using your app" ([Q&A](https://developer.apple.com/support/age-assurance/)).

From Expo, use the official **`expo-age-range`** module. Version 57.0.5 is the SDK 57 release, matching hopon's `expo ~57.0.26`. It wraps the Declared Age Range calls but **not PermissionKit**, so consent for significant changes needs a ~40-line local Expo module or a policy of not making significant changes.

## Evidence levels used below

- **Statute:** enrolled or chaptered bill text from the state legislature, or the national law's official text. Binding where in force.
- **Court:** an order or docket from the court itself. These rulings decide whether a statute is enforceable today.
- **Apple:** Apple Developer news, documentation, the age assurance Q&A, and the Developer Program License Agreement (DPLA). This is how Apple implements the law, and it binds hopon contractually.
- **Secondary:** law-firm or news write-ups. Used only where no primary source could be reached, and flagged as such.

## 1. Which regions apply, and from when

Status as of 2026-10-10:

| Jurisdiction | Law | Developer duties start | Status |
| --- | --- | --- | --- |
| **Texas** | [SB 2420](https://capitol.texas.gov/tlodocs/89R/billtext/html/SB02420F.htm) (2025), App Store Accountability Act, Bus. & Com. Code ch. 121 | Effective Jan 1, 2026 (§3 of the Act). Enforceable since **June 4, 2026**. Apple applies it to **new** Texas Apple Accounts from June 4, 2026 ([Apple](https://developer.apple.com/news/?id=sg176nne)) | **In force.** The district court enjoined it on Dec 23, 2025 ([Apple](https://developer.apple.com/news/?id=8jzbigf4); the order itself is hosted only by [plaintiff CCIA](https://ccianet.org/litigation/ccia-v-paxton-w-d-tex/)). The Fifth Circuit granted a stay pending appeal on June 4, 2026 in Nos. 25-51073 and 26-50001 ([published order](https://www.ca5.uscourts.gov/opinions/pub/25/25-51073-CV0.pdf)). The Supreme Court denied applications to vacate the stay on July 6, 2026 ([25A1390](https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/25a1390.html), [25A1389](https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/25a1389.html)). The merits appeal is still pending: no published merits opinion was found on the Fifth Circuit site. |
| **Utah** | [SB 142](https://le.utah.gov/Session/2025/bills/enrolled/SB0142.pdf) (2025), amended by [HB 498](https://le.utah.gov/Session/2026/bills/enrolled/HB0498.pdf) (2026), Utah Code 13-76 | **May 6, 2027**. HB 498 moved it from May 6, 2026. Stores must also cover accounts that already exist, within 12 months of that date (13-76-201(1)(a)) | Enacted. The governor signed HB 498 on Mar 18, 2026 ([status](https://le.utah.gov/~2026/bills/static/HB0498.html)). HB 498 removed the deceptive-trade-practice clause, so the only enforcement is a private suit by a harmed minor or parent, from May 6, 2027 (13-76-401). Apple's [Feb 24, 2026 post](https://developer.apple.com/news/?id=f5zj08ey) still says new Utah accounts from **May 6, 2026**, and Apple has posted no correction. CCIA's federal suit against SB 142 was voluntarily dismissed after the amendment (_secondary_: [CCIA fact sheet](https://ccianet.org/wp-content/uploads/2026/02/CCIA-v.-Brown-Fact-Sheet-Utah-SB142.pdf), [Alston & Bird](https://www.alstonprivacy.com/challenge-to-utahs-app-store-accountability-act-voluntarily-dismissed-following-statutory-amendments/)). |
| **Louisiana** | [HB 977, Act 185](https://legis.la.gov/legis/ViewDocument.aspx?d=1475238) (2026), R.S. 51:1771–1775. It replaces [HB 570, Act 481](https://legis.la.gov/legis/ViewDocument.aspx?d=1427667) (2025) | **July 1, 2027** (Act 185 §6). Act 185 §1 says Act 481, which was due on July 1, 2026, "shall not become effective" | Enacted. Signed May 15, 2026 ([status](https://legis.la.gov/legis/BillInfo.aspx?s=26RS&b=HB977&sbi=y)). Apple's Feb 2026 post still says new Louisiana accounts from **July 1, 2026**. |
| **Alabama** | [HB 161](https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2026RS/HB161-enr.pdf) (2026), App Store Accountability Act | **Jan 1, 2027** (§15). Stores must also verify accounts that existed on Oct 2, 2026, before Oct 1, 2027 (§2(a)) | Enacted. It was signed Feb 2026 as Act 2026-59 (_secondary_: [Alabama Reflector/ALReporter](https://www.alreporter.com/2026/02/19/gov-ivey-signs-app-store-accountability-act-into-law/); the signature was not verified on ALISON). Apple has not announced anything for Alabama. |
| **California** | [AB 1043](https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260AB1043) (2025), Digital Age Assurance Act, Civ. Code 1798.500–.505, amended by [AB 1856](https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260AB1856) (ch. 184, Sept 10, 2026) | **Jan 1, 2027** (1798.505). Apps downloaded before 2027 that were updated on or after Jan 1, 2026 must request a signal before **July 1, 2027** (1798.502(b)) | Enacted. This is a **different model**: the operating system provider collects the age at device setup and sends a bracket signal. There is no parental-consent-per-download duty. Apple has not announced anything for California. |
| **Brazil** | [Lei 15.211/2025](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/L15211.htm) (ECA Digital) | **Mar 17, 2026** (art. 41-A) | In force. This is a broad child-safety law, not just an app-store law (see §3). Apple shares age categories for Brazil when the user or a guardian agrees ([Apple](https://developer.apple.com/news/?id=f5zj08ey)). |
| **Australia** | Online Safety Act 2021 s 63C, plus [Age-Restricted Social Media Platforms Rules 2025](https://www.legislation.gov.au/F2025L00889/latest/text) | **Dec 10, 2025** ([Apple](https://developer.apple.com/news/?id=y1bckxf8)) | In force. It is a social-media minimum age of 16, not an app-store law. Whether hopon is in scope is a legal question (see §3). |
| **Singapore** (and AU, BR) | Store-side rules | Feb 24, 2026 | Apple blocks downloads of **18+-rated** apps unless the user is confirmed adult ([Apple](https://developer.apple.com/news/?id=f5zj08ey)). This doesn't touch a 13+ app. Apple notes developers "may have separate obligations". Singapore's own code was not researched. |

Not included:

- **Korea:** Apple's [Aug 12, 2026 post](https://developer.apple.com/news/?id=oj3r9pvw) covers region-specific age **ratings**, not age assurance. One search summary claimed otherwise; the post itself doesn't say so.
- **EU and UK:** Apple's age-assurance pages don't name them, and they were not researched.
- **Other US states:** none were found enacted beyond the five above. Bills elsewhere were seen only in secondary trackers.

**What this means for the "which regions at launch" decision.** Availability is set per country, not per state, so a US launch can't leave Texas out. Texas applies only to **new** Texas Apple Accounts created since June 4, 2026, and Apple sets that scope, not hopon. The API call tells hopon per user whether a law applies (`isEligibleForAgeFeatures`, `requiredRegulatoryFeatures`), so hopon needs no geolocation of its own.

## 2. What the US laws ask of the developer

The store's duties are similar in all four app-store laws. The store verifies the age category at account creation, links minor accounts to a parent account, gets parental consent for each download and purchase, re-asks the parent after a developer's significant-change notice, notifies developers of revocation, and shares age category plus consent status with developers. All of that is Apple's job, not hopon's. ([TX §§121.021–.025](https://capitol.texas.gov/tlodocs/89R/billtext/html/SB02420F.htm); [UT 13-76-201](https://le.utah.gov/Session/2026/bills/enrolled/HB0498.pdf); [LA 51:1772](https://legis.la.gov/legis/ViewDocument.aspx?d=1475238); [AL §§2–8](https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2026RS/HB161-enr.pdf).)

The developer's duties differ in detail:

| Duty | Texas SB 2420 | Utah 13-76 (from May 6, 2027) | Louisiana 51:1771ff. (from July 1, 2027) | Alabama HB 161 (from Jan 1, 2027) | California 1798.501 (from Jan 1, 2027) |
| --- | --- | --- | --- | --- | --- |
| **Read the age signal** | "Create and implement a system" that uses the store's data to verify each user's age category and, for minors, whether consent was obtained (§121.054) | Verify age category and consent through the store. Request it at download or purchase, at a significant change, or to comply with law. Optional re-checks: at most once in 12 months, on suspected account transfer, or at account creation (202(1)–(2)) | Same as Utah (1773(A)(1), (A)(7), (B)) | Same as Utah, plus first launch of a pre-installed app (§9(a)(1), (4), (b)) | **Must** request a signal "when the application is downloaded onto, and launched from, a particular device". Having it means **actual knowledge** of the user's age range, even if ignored (1798.501(d)(1)–(2)). Must not ask for a signal unless the law requires it (1798.501(e)) |
| **Use the age to restrict features** | Use only to "enforce restrictions and protections … related to age", comply with law, and implement safety features and defaults (§121.055(a)). No specific restriction is mandated | Use only for the same three purposes (202(5)). The first developer-created defaults use the **lowest** age category from the store's data or the developer's own (202(3)) | "Enforce all age-related restrictions". Use the verified signal for legally required minimum ages and age-appropriate defaults. The developer may rely on the store's signal over its own unless it has actual knowledge its own is more accurate (1773(A)(3), (C)) | Use only for the same three purposes. Lowest category for defaults (§9(a)(3), (5)) | Treat the signal as the **primary** age indicator, unless internal "clear and convincing information" says otherwise. Use it to comply with applicable law (1798.501(d)(3)–(4)). This is how COPPA's actual-knowledge test comes in (see open points) |
| **Significant change: notify the store first** | Before any significant change to the **terms of service or privacy policy**. Significant means it changes the data collected or shared, affects the rating, adds purchases or ads, or "materially changes the functionality or user experience" (§121.053) | Notify the store of a significant change. HB 498 **narrowed** the definition to data categories, rating or content descriptors, first-ever in-app purchases, and first-ever ads. "Functionality or user experience" was removed (101(20), 202(1)(b)) | Notify. The definition keeps "materially changes … functionality or user experience" (1771(19), 1773(A)(2)) | Notify. The definition covers data, first-ever monetization, and rating (§1(19), §9(a)(2)) | None |
| **Contracts with minors** | May not enforce a contract or terms against a minor who agreed without consent (§121.056(a)(1)) | May not enforce terms against a minor unless parental consent was verified through the store (202(4)(a)) | Same (1773(D)(1)) | Same (§9(c)(1)) | None |
| **Data limits** | Don't share the data. **Delete** the store-provided personal data "on completion of the verification" (§121.055(b), §121.056(a)(3)) | Don't share the age category data (202(4)(c)) | Don't **sell** it (1773(D)(3)) | Don't share it (§9(c)(3)) | Ask for the minimum. Don't share for other purposes (1798.501(d)(4)) |
| **Rating** | Assign an age rating to the app (and to each purchase) using the four age categories, and give the store the reasons (§121.052) | HB 498 says the chapter doesn't require a rating system (404(6)) | Safe harbor for a rating set by widely adopted industry standards (1774(B)) | Same safe harbor (§12(b)) | None |
| **Safe harbor** | Not liable for the verification duty if hopon relied in good faith on the store's age and consent data and otherwise complied (§121.056(c)) | Good-faith reliance on store data plus compliance with 202 (402(1)) | Compliance with 1773 (1774(A)(2)) | Good-faith reliance plus compliance (§12(a)) | A good-faith effort shields against an erroneous signal (1798.503(c), added by AB 1856) |
| **Enforcement** | A violation is a deceptive trade practice, "actionable under" Bus. & Com. Code ch. 17 subch. E (§121.101) | Only a private suit by a harmed minor or parent: the greater of actual damages or **$1,000 per violation**, plus fees (401) | Attorney General. Up to **$10,000 per violation**, after a 45-day notice and cure period (1775) | Attorney General only, for knowing or reckless violations. Up to **$7,500 per violation** (§11) | Attorney General. Up to **$2,500 per affected child** for negligent violations and **$7,500** for intentional ones (1798.503(a)) |

Points that bear on hopon specifically:

- **No law requires hopon to ban 13–17s or to add a parental gate inside the app.** The store already got consent for the download. hopon's duties are to read the signal, honor it in whatever age restrictions hopon has or the law sets, and run the significant-change flow.
- **The Rules agreement.** hopon requires an explicit "I agree" to the [Rules](../../GLOSSARY.md) before anything signed in. Four laws bar enforcing terms against a minor without parental consent verified through the store. In practice that consent comes with the Apple download consent. How hopon "verifies" it through Apple's API is not spelled out (see open points).
- **Rule changes may be significant changes.** The glossary says "If the Rules change, everyone agrees again." Under Texas, a significant change is one to the terms of service or privacy policy that also meets one of the listed effects. Apple says whether terms or privacy policy changes count "depends" and to ask counsel ([Q&A](https://developer.apple.com/support/age-assurance/)). Today hopon has no ads or in-app purchases. Adding either later, or collecting new data categories, is a significant change in every app-store state.
- **Rating changes are significant changes everywhere.** Apple: "Texas state law considers a change in the age rating of an app to be a significant change" ([Apple](https://developer.apple.com/news/?id=2ezb6jhj)). Raising hopon above 13+, which #51 calls "a one-field change", would trigger the parental consent flow for minors in regulated regions.
- **Texas's delete rule.** §121.055(b) says to delete the store-provided personal data when verification is done. Persisting the raw age range on hopon's server, for example on the Clerk user, may conflict with it. A derived flag like "social features on or off" may not. This is a legal call.

## 3. Non-US regions Apple names

- **Brazil (ECA Digital, in force Mar 17, 2026).** Stores and operating systems must provide an age signal through an API (art. 12(III)). Providers whose services are "directed to or likely accessed by" children and adolescents must be able to receive it (art. 14). Regardless of the store's measures, they must have their **own** mechanisms against inappropriate content (art. 14 sole para.). Accounts of users **up to 16** on such services must be linked to a legal guardian's account (art. 24). Social networks must not build behavioral profiles of minors for advertising (art. 26). It also requires a legal representative in Brazil (art. 40). ([Lei 15.211](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/L15211.htm).) This goes well beyond reading a signal. A Brazil launch needs its own review.
- **Australia (Social Media Minimum Age, Dec 10, 2025).** Covered platforms must stop under-16s from having accounts ([Apple](https://developer.apple.com/news/?id=y1bckxf8)). Under the 2025 Rules, a service is in scope only if it has a recommender feature or a "logged-in feature": an endless feed, feedback such as like counts, or time-limited posts, behind an account (r 4A). Excluded are services whose "sole or primary purpose" is enabling end-users "to play online games with other end-users" (r 5(1)(b)) ([Rules](https://www.legislation.gov.au/F2025L00889/latest/text)). hopon has a feed and likes, and its games are played alone, not with other users. So the games exclusion may not fit, and hopon could be in scope. This is a legal question; it is unverified and was not researched further. Apple suggests the Declared Age Range API with an under-16 gate, the App Store description, and a higher age rating as tools.
- **Singapore.** Apple blocks 18+ downloads ([Apple](https://developer.apple.com/news/?id=f5zj08ey)). No developer duty was identified for a 13+ app. Singapore's own code was not read.

## 4. Apple's side

### What Apple says developers must do

From the [age assurance Q&A](https://developer.apple.com/support/age-assurance/) (Apple):

- "developers are responsible for their own age restrictions". In legally required regions, "you must check the age of the people using your app."
- For significant updates, "you're responsible for preventing access to your app or features when required". The child must be blocked from the update until the parent consents.
- When a parent revokes consent, Apple prevents the app from launching. Developers handle it with the `RESCIND_CONSENT` notification.
- An 18+ rating doesn't exempt an app. Where legally required, apps still check age with the API.
- There are no App Review changes for age assurance. The API is available worldwide. Existing accounts on iOS 18 or earlier are unaffected.
- Building for all of it needs the iOS 26.2 SDK and Xcode 26.2 or later.

Further Apple wording:

- The Texas post says "it's the developer's responsibility to determine when there's a significant change" ([Apple](https://developer.apple.com/news/?id=sg176nne)).
- [DPLA](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/) §3.3.3(O) allows the API "only for the purposes of providing age-appropriate content and/or features … or to comply with laws". It bars sharing or selling the data to data brokers. It also makes the developer "solely responsible" for legal compliance.

### The APIs

| Piece | Availability | What it does |
| --- | --- | --- |
| [`com.apple.developer.declared-age-range`](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.declared-age-range) entitlement | iOS 26.0 | Required to call the API. You turn it on as the Declared Age Range capability. |
| [`AgeRangeService.requestAgeRange(ageGates:_:_:in:)`](<https://developer.apple.com/documentation/declaredagerange/agerangeservice/requestagerange(agegates:_:_:in:)-2go8c>) | iOS 26.0 | Shows a system sheet and returns `.sharing(range)` or `.declinedSharing`. The app passes up to three age gates, and each range must span at least 2 years. The range has `lowerBound` and `upperBound` (nil means below the lowest gate or at least the highest), an `ageRangeDeclaration` (self-declared, guardian-declared, or confirmed by payment, ID or another method) and `activeParentalControls`. In regulated regions the user **can't decline**, and the law's gates (13/16/18) override yours. Responses are cached until the anniversary of the declaration. ([article](https://developer.apple.com/documentation/declaredagerange/requesting-people-share-their-age-range-with-your-app)) |
| [`isEligibleForAgeFeatures`](https://developer.apple.com/documentation/declaredagerange/agerangeservice/iseligibleforagefeatures) | iOS 26.2 | `true` when the person's location and account put them under an age-assurance law. Always `false` on macOS. |
| [`requiredRegulatoryFeatures`](https://developer.apple.com/documentation/declaredagerange/agerangeservice/requiredregulatoryfeatures) and [`RegulatoryFeature`](https://developer.apple.com/documentation/declaredagerange/agerangeservice/regulatoryfeature) | iOS 26.4 | Returns which duties apply: `declaredAgeRangeRequired`, `significantAppChangeRequiresAdultNotification`, `significantAppChangeRequiresParentalConsent`. Apple says not to use the older `significantAppChangeApprovalRequired` flag. |
| [`showSignificantUpdateAcknowledgment(in:updateDescription:)`](<https://developer.apple.com/documentation/declaredagerange/agerangeservice/showsignificantupdateacknowledgment(in:updatedescription:)>) and `SignificantUpdateAction` | iOS 26.4 | System sheet for adults to acknowledge a significant update. |
| PermissionKit [`SignificantAppUpdateTopic`](https://developer.apple.com/documentation/permissionkit/significantappupdatetopic) and [`AskCenter`](https://developer.apple.com/documentation/permissionkit/askcenter) | iOS 26.2 | `AskCenter.shared.ask(PermissionQuestion(significantAppUpdateTopic:), in:)` sends the parent a consent request describing the change. `AskCenter.shared.responses(for:)` delivers the answer. iOS 27 adds `askSignificantChangePermission(for:permissionFlow:in:)` with ask-to-approve, approve-in-person and acknowledgment flows ([doc](<https://developer.apple.com/documentation/permissionkit/askcenter/asksignificantchangepermission(for:permissionflow:in:)-nm9w>)). |
| StoreKit [`AppStore.ageRatingCode`](https://developer.apple.com/documentation/storekit/appstore/ageratingcode) | iOS 26.2 | The app's current rating on the device, so the app can detect a rating change and ask for consent. |
| [`RESCIND_CONSENT`](https://developer.apple.com/documentation/appstoreservernotifications/notificationtype) server notification | ASSN v2 | Sent when a parent withdraws consent. The payload's [`appData`](https://developer.apple.com/documentation/appstoreservernotifications/appdata) carries `bundleId`, `environment` and `signedAppTransactionInfo`, which includes [`appTransactionId`](https://developer.apple.com/documentation/appstoreserverapi/jwsapptransactiondecodedpayload). Apple tells developers to "immediately restrict the child's access". To map it to a hopon account, the app would send `AppTransaction.appTransactionID` to the API at sign-in. |
| [Sandbox testing](https://developer.apple.com/documentation/storekit/testing-age-assurance-in-sandbox) | iOS 26.2 | Settings › Developer › Sandbox Apple Account › Age Assurance lets you pick a test case: under 13, 13–15, 16–17, or 18+ confirmed or unconfirmed, with consent approved or declined. "Revoke App Consent" triggers a `RESCIND_CONSENT`. It needs a device in Developer Mode. |

More Apple material:

- Apple's sample, [Implementing age assurance and permissions](https://developer.apple.com/documentation/declaredagerange/implementing-age-assurance-and-permissions), shows the full significant-change flow. It records acknowledged changes in iCloud key-value storage and skips changes older than `AppTransaction.originalAppVersion`.
- WWDC25 sessions: [Deliver age-appropriate experiences in your app](https://developer.apple.com/videos/play/wwdc2025/299/) and [Enhance child safety with PermissionKit](https://developer.apple.com/videos/play/wwdc2025/293/). No WWDC26 session on the topic was found in the session list.

### A related Apple rule that touches the under-13 decision

Since July 2026 (required for submissions from Sept 2026), the age rating questionnaire asks about social media capabilities. An app with them gets a minimum 13+ rating. If the app instead declares those capabilities "are disabled for anyone under 13", Apple says "you'll also need to use the Declared Age Range API (at a minimum) to check users' age ranges" ([Introducing Time Allowances](https://developer.apple.com/news/?id=0d2gpmml); [questionnaire](https://developer.apple.com/news/?id=tlur8uvi)). So any "social features off for under-13s" design implies calling the API, regardless of state law.

## 5. Calling it from Expo

**Use [`expo-age-range`](https://www.npmjs.com/package/expo-age-range).** It is an official Expo SDK module from the [`expo/expo`](https://github.com/expo/expo/tree/sdk-57/packages/expo-age-range) monorepo. The `sdk-57` dist-tag is `57.0.5` (released 2026-09-11), matching hopon's `expo ~57.0.26` (`apps/mobile/package.json`). The package was first published on 2025-10-15 and has had regular releases since. [Docs](https://docs.expo.dev/versions/latest/sdk/age-range/) list it as "Included in Expo Go". Install with `npx expo install expo-age-range`, then add the entitlement in `app.json`:

```json
{
  "expo": {
    "ios": {
      "entitlements": { "com.apple.developer.declared-age-range": true }
    }
  }
}
```

What its iOS source (`ios/AgeRangeModule.swift`, read from the 57.0.5 tarball) covers:

| JS function | Wraps | Notes |
| --- | --- | --- |
| `requestAgeRangeAsync({threshold1, threshold2?, threshold3?})` | `requestAgeRange(ageGates:…in:)` | Resolves to `{lowerBound, upperBound, ageRangeDeclaration: 'selfDeclared' \| 'guardianDeclared' \| 'confirmed', activeParentalControls}`. If the user declines, it **rejects** with `ERR_AGE_RANGE_USER_DECLINED`. **Before iOS 26 it resolves `lowerBound: 18`, as if the user were an adult.** |
| `isEligibleForAgeFeaturesAsync()` | `isEligibleForAgeFeatures` | `null` before iOS 26.2. Treat `null` as unknown. |
| `getRequiredRegulatoryFeaturesAsync()` | `requiredRegulatoryFeatures` | `null` before iOS 26.4. |
| `showSignificantUpdateAcknowledgmentAsync(text)` | `showSignificantUpdateAcknowledgment(in:updateDescription:)` | Adult acknowledgment only. A no-op before iOS 26.4. |

**Gaps:** there is no PermissionKit (`SignificantAppUpdateTopic` / `AskCenter`) and no `AppStore.ageRatingCode`. Community packages ([`react-native-age-signals`](https://github.com/shtefanilie/react-native-age-signals), [`react-native-play-age-range-declaration`](https://github.com/Gautham495/react-native-play-age-range-declaration)) exist, but their PermissionKit coverage wasn't checked. They add a non-Expo dependency for little gain.

If hopon ever ships a significant change to minors in a parental-consent region, it needs a small local Expo module (`npx create-expo-module --local`). A sketch, unbuilt and untested:

```swift
import ExpoModulesCore
import PermissionKit

public class SignificantChangeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SignificantChange")

    // Asks the parent to approve continued use after a significant change.
    AsyncFunction("askParentAsync") { (description: String) in
      guard #available(iOS 26.2, *) else { return }
      let vc = await MainActor.run { [appContext] in appContext?.utilities?.currentViewController() }
      guard let vc else { throw Exception(name: "NoViewController", description: "No view controller") }
      let topic = SignificantAppUpdateTopic(description: description)
      try await AskCenter.shared.ask(PermissionQuestion(significantAppUpdateTopic: topic), in: vc)
    }

    Events("onParentResponse")
    OnStartObserving {
      guard #available(iOS 26.2, *) else { return }
      Task { [weak self] in
        for await response in AskCenter.shared.responses(for: SignificantAppUpdateTopic.self) {
          self?.sendEvent("onParentResponse", ["approved": response.choice.answer == .approval])
        }
      }
    }
  }
}
```

The `response.choice.answer == .approval` check is taken from Apple's sample code above.

**Build implications:**

- hopon has no `ios/` directory and no `eas.json`. Today it runs in Expo Go (README, `run-ios` skill).
- `expo-age-range` itself runs in Expo Go. But the entitlement only applies to hopon's own signed binary, and Apple's sandbox scenarios need a real device. So real testing needs a development build (`expo-dev-client` or `npx expo run:ios`) and an App ID with the Declared Age Range capability.
- A local PermissionKit module can't run in Expo Go at all.
- Shipping to the App Store needs a hopon-signed build anyway, so this adds testing setup, not a new release path.

## 6. Options for what hopon does with the answer

This section lays out options and doesn't pick one. The call order is the same for every option:

1. Call `isEligibleForAgeFeaturesAsync()` and `getRequiredRegulatoryFeaturesAsync()`.
2. If either is `true` or non-empty, or unknown, call `requestAgeRangeAsync({ threshold1: 13, threshold2: 16, threshold3: 18 })`. These gates match the statutory categories.
3. In a regulated region, a decline isn't possible. Outside one, a decline means hopon treats the person as unknown.

Do this at first launch or at sign-in. Utah and Louisiana allow a re-check at account creation, and California requires one at download and launch.

### Under 13

A 13+ app can still reach under-13s: a parent can approve an exception to Screen Time's rating limit ([Q&A](https://developer.apple.com/support/age-assurance/)). In a regulated region, hopon will then **know** the user is under 13.

| Option | Grounding | Trade-offs |
| --- | --- | --- |
| **A. Block the app.** Show a "hopon is for 13 and up" screen and no sign-in | Matches the 13+ rating and #51's "no second content tier". Every law lets the developer enforce its own age restrictions (TX §121.055(a)(1); UT 202(5)(a); LA 1773(A)(4); AL §9(a)(3)). From May 2027, Utah also lets a developer ask the store to keep **minor** accounts (under 18) from downloading (UT 202(6)) | Simplest. hopon never collects data from a known under-13, which avoids COPPA's actual-knowledge trigger (not researched). It turns away kids whose parents approved the app. |
| **B. Signed-out only.** Under-13s can browse and play the feed but can't sign in, Make, Comment, Save or Report | Apple's "social features disabled for under 13" questionnaire option fits this, and it requires the Declared Age Range API ([Apple](https://developer.apple.com/news/?id=0d2gpmml)) | Keeps the play experience. It needs a gate on every signed-in path, and the feed still shows user-made content rated for 13+. If hopon ever selects this option in the questionnaire, its rating could drop below 13+, which conflicts with #51. Collecting nothing still matters for COPPA. |
| **C. Full access with the store's parental consent** | Allowed by the app-store laws: the store consented to the download | COPPA's own verifiable parental consent is a separate regime from the store's consent. It isn't researched here and is likely heavy. It also contradicts the 13+ rating. |

### 13–17

| Option | Grounding | Trade-offs |
| --- | --- | --- |
| **A. Same as adults.** Read the signal, change nothing, and run the significant-change flow when needed | No US law mandates feature restrictions for 13–17. The store handles download consent. The duties are to read the signal, notify significant changes, and honor revocation | Least product work. Minimum compliance: the API call, avoiding significant changes or building the PermissionKit module, and possibly a `RESCIND_CONSENT` endpoint (Apple already blocks launch). Brazil and Australia would not be satisfied by this. |
| **B. Safer defaults for 13–15** (or 13–17), for example comments only from people they follow, or comments off by default | Utah, Alabama and Louisiana require the **lowest** age category when hopon creates safety defaults (UT 202(3); AL §9(a)(5); LA 1773(C)). That is a rule about how to apply defaults hopon chooses, not a mandate to have them | More code paths. hopon has no follow graph today. Once hopon creates age-based defaults, the "lowest category" rule binds it. |
| **C. Block under-16s or under-18s where a law asks.** For example, Australia under 16, or Brazil-style guardian-linked accounts under 16 | Australia s 63C, if hopon is in scope; Brazil art. 24 | Only needed if launching there. Raising the global rating to 18+ doesn't remove the API duty ([Q&A](https://developer.apple.com/support/age-assurance/)), and the rating change is itself a significant change. |

Separate from the age bands is **whether hopon ships significant changes to minors at all**. If it never adds ads or in-app purchases and never changes its data categories or rating, it may never need the PermissionKit flow in Utah or Alabama. Texas and Louisiana also count material changes to functionality or user experience, which is vaguer.

## 7. Google Play, briefly

The [Play Age Signals API](https://developer.android.com/google/play/age-signals/overview) (beta) returns age signals for Brazil from Mar 17, 2026 and for Texas accounts created after May 28, 2026. Other US states will be "announced ahead". Google forbids any use beyond age-appropriate experiences and compliance, quoted as "advertising, marketing, user profiling, or analytics". `expo-age-range` wraps it too: `requestAgeSignalsAccessAsync()` comes first, and `setFakeAgeSignals()` is available for testing. Not needed while hopon is iOS-first.

## Open and unverified points

- **Texas merits appeal.** No published Fifth Circuit merits opinion was found (checked `ca5.uscourts.gov/opinions/pub` for Nos. 25-51073 and 26-50001). An August 2026 oral argument is reported only by secondary sources. A merits ruling could reinstate the injunction.
- **Apple's Utah and Louisiana dates.** Apple's Feb 24, 2026 post still says May 6, 2026 and July 1, 2026, which predate the amendments. Whether Apple already shares Utah categories, or will wait until 2027, is unverified. `isEligibleForAgeFeatures` will tell at runtime.
- **Alabama and California.** Apple hasn't said how it will implement either. California's model (an OS signal for every user, with actual knowledge) is different from Apple's current per-request sharing.
- **Verifying "consent obtained".** Texas §121.054(a)(2), Utah 202(1)(a)(ii) and Louisiana 1773(A)(1)(b) ask the developer to verify that consent was obtained. Apple's API documents an age range, a declaration method, and regulatory features, but no explicit per-user "consent obtained" field. The working assumption, unverified, is that an installed app means the download was consented to and that `RESCIND_CONSENT` covers withdrawal.
- **Texas §121.055(b).** Whether storing the age range server-side violates the deletion duty, or what may be stored, is a legal question.
- **COPPA.** Getting a signal that a user is under 13 likely gives hopon actual knowledge under COPPA (16 CFR part 312). California's 1798.501(d)(2) makes that explicit for California. This was not researched; it matters for under-13 options B and C.
- **Australia scope.** Whether hopon is an "age-restricted social media platform" turns on r 4A and r 5(1)(b). This is legal advice territory and unverified.
- **Alabama signature and Act number,** and the Utah suit's dismissal, come from secondary sources only.
- **Primary-source access.** California's leginfo site and the Australian register were read through a browser, because they block non-browser fetches. Both were read from the official sites.

## Sources

**Statutes and courts:**

- [TX SB 2420 enrolled](https://capitol.texas.gov/tlodocs/89R/billtext/html/SB02420F.htm)
- [Fifth Circuit stay order, June 4, 2026](https://www.ca5.uscourts.gov/opinions/pub/25/25-51073-CV0.pdf)
- [SCOTUS 25A1390](https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/25a1390.html) and [25A1389](https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/25a1389.html)
- [UT SB 142 (2025)](https://le.utah.gov/Session/2025/bills/enrolled/SB0142.pdf), [UT HB 498 (2026)](https://le.utah.gov/Session/2026/bills/enrolled/HB0498.pdf), [HB 498 status](https://le.utah.gov/~2026/bills/static/HB0498.html)
- [LA Act 481 (2025)](https://legis.la.gov/legis/ViewDocument.aspx?d=1427667), [LA Act 185 (2026)](https://legis.la.gov/legis/ViewDocument.aspx?d=1475238), [HB 977 status](https://legis.la.gov/legis/BillInfo.aspx?s=26RS&b=HB977&sbi=y)
- [AL HB 161 enrolled](https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2026RS/HB161-enr.pdf)
- [CA AB 1043](https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260AB1043), [CA AB 1856](https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260AB1856)
- [Brazil Lei 15.211/2025](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/L15211.htm)
- [Australia Age-Restricted Social Media Platforms Rules 2025](https://www.legislation.gov.au/F2025L00889/latest/text)

**Apple:**

- [Age assurance Q&A](https://developer.apple.com/support/age-assurance/)
- News: [Oct 8, 2025](https://developer.apple.com/news/?id=btkirlj8), [Nov 4, 2025](https://developer.apple.com/news/?id=2ezb6jhj), [Dec 8, 2025](https://developer.apple.com/news/?id=y1bckxf8), [Dec 23, 2025](https://developer.apple.com/news/?id=8jzbigf4), [Feb 24, 2026](https://developer.apple.com/news/?id=f5zj08ey), [June 3, 2026](https://developer.apple.com/news/?id=sg176nne), [June 8, 2026](https://developer.apple.com/news/?id=0d2gpmml), [July 9, 2026](https://developer.apple.com/news/?id=tlur8uvi), [Aug 12, 2026](https://developer.apple.com/news/?id=oj3r9pvw)
- [Declared Age Range](https://developer.apple.com/documentation/declaredagerange), [Requesting age range](https://developer.apple.com/documentation/declaredagerange/requesting-people-share-their-age-range-with-your-app), [Implementing age assurance (sample)](https://developer.apple.com/documentation/declaredagerange/implementing-age-assurance-and-permissions)
- [PermissionKit](https://developer.apple.com/documentation/permissionkit), [Testing in sandbox](https://developer.apple.com/documentation/storekit/testing-age-assurance-in-sandbox), [notificationType](https://developer.apple.com/documentation/appstoreservernotifications/notificationtype)
- [DPLA §3.3.3(O)](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/), [App availability](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/manage-availability-for-your-app-on-the-app-store)
- WWDC25 [299](https://developer.apple.com/videos/play/wwdc2025/299/) and [293](https://developer.apple.com/videos/play/wwdc2025/293/)

**Expo and Google:**

- [expo-age-range on npm](https://www.npmjs.com/package/expo-age-range), [source (sdk-57)](https://github.com/expo/expo/tree/sdk-57/packages/expo-age-range), [Expo docs](https://docs.expo.dev/versions/latest/sdk/age-range/)
- [Play Age Signals](https://developer.android.com/google/play/age-signals/overview)

**Secondary (flagged where used):**

- [CCIA v. Paxton page](https://ccianet.org/litigation/ccia-v-paxton-w-d-tex/)
- [CCIA v. Brown fact sheet](https://ccianet.org/wp-content/uploads/2026/02/CCIA-v.-Brown-Fact-Sheet-Utah-SB142.pdf)
- [Alston & Bird on the Utah dismissal](https://www.alstonprivacy.com/challenge-to-utahs-app-store-accountability-act-voluntarily-dismissed-following-statutory-amendments/)
- [ALReporter on Alabama](https://www.alreporter.com/2026/02/19/gov-ivey-signs-app-store-accountability-act-into-law/)
