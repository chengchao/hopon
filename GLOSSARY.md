# hopon

Make a small game from one sentence, then swipe a feed to discover and play other people's games.

## Language

**Game**: A small playable HTML game made from one sentence. It is a **Draft** until its **Creator** publishes it. _Avoid_: Microgame, app, post

**Draft**: A **Game** that only its **Creator** can see and play.

**Creator**: The signed-in person who made a **Game**. _Avoid_: Author, owner (in product language)

**Handle**: The public @name a person picks; it is shown on their published **Games** and **Comments**. _Avoid_: Username, display name

**Save**: A private mark a signed-in person puts on a published **Game** so they can find it again later in their **Saved** list. Only that person ever sees their saves; unlike a like, nobody else can see or count them. _Avoid_: Bookmark, favorite

**Comment**: A short plain-text note a signed-in person leaves on a published **Game**. Comments form one flat list per **Game**, with no replies, and the person who wrote it, the **Game**'s **Creator** or the **Operator** can **Delete** it. _Avoid_: Reply, message, review

**Delete**: Permanently take away a published **Game** or a **Comment**, so nobody can see it again. Deleting a **Game** also takes away its likes, **Comments** and **Saves**. The **Creator** or the **Operator** deletes a **Game**; there is no hiding it and bringing it back. _Avoid_: Remove, unpublish, take down

**Operator**: The person who runs hopon, deletes **Games** and **Comments** that break its **Rules**, and **Bans** the people who post them. They do it from a password-protected web page outside the app; in the app the Operator is an ordinary person. _Avoid_: Admin, moderator

**Rules**: What everyone agrees to, with an explicit "I agree", before they can do anything signed in: zero tolerance for objectionable content and abusive people. Breaking them gets **Games** and **Comments** **Deleted** and can get a person **Banned**. If the Rules change, everyone agrees again. _Avoid_: Terms, community guidelines, ToS

**Report**: A signed-in person's flag on someone else's published **Game** or **Comment**, giving a reason, for the **Operator** to review. The reported **Game** or **Comment** disappears for the reporter at once and stays up for everyone else until the **Operator** either **Deletes** it or dismisses the report, leaving it up. A report outlives the **Game** or **Comment** it points at. _Avoid_: Flag, complaint

**Block**: A signed-in person's choice to stop seeing another person, made from one of that person's published **Games** or **Comments**. Afterwards neither of them sees the other's **Games** or **Comments**, and the blocked person can't **Comment** on the blocker's **Games**. Nobody is told. Nothing is **Deleted**, and unblocking from the person's **Blocked accounts** list brings everything back. _Avoid_: Mute, ban

**Blocked accounts**: The list of everyone a person has **Blocked**, each shown by the **Handle** they had when they were blocked.

**Ban**: The **Operator**'s act of shutting a person out of hopon: they can no longer sign in, and all their published **Games** and **Comments** are **Deleted**. Only the **Operator** bans, never automatically, and can lift a ban, which lets the person sign in again but brings nothing back. _Avoid_: Eject, suspend, lock

**Screening**: The automatic check that refuses text breaking hopon's **Rules** before anyone else can see it: the sentence a **Game** is made from, a **Game**'s title and description when it is published, a **Comment**, and the **Handle** shown on them. Refused text is never kept; the person changes it and tries again. Unlike a **Report**, nobody reviews it. _Avoid_: Filter, moderation
