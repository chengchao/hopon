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

**Operator**: The person who runs hopon and deletes **Games** and **Comments** that break its rules. _Avoid_: Admin, moderator
