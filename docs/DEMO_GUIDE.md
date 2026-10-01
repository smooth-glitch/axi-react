# Demo guide: set up Agile Labs from scratch, and the new admin features

App: **https://10.0.2.146** (office network, or VPN: ask AXPERT SUPPORT for the VPN config).
You need an authenticator app on your phone (Google Authenticator or Microsoft Authenticator) for the admin, and
one for each person who signs in during the demo.

## Part 1: the setup, step by step

### 1. Create Agile Labs, Arjun as administrator
1. Open the site and click **First Time Setup**.
2. Fill in: organisation `Agile Labs`, your full name, username `arjun`, your company email, mobile (+91...).
   Leave "setup token" blank. Click **Send Verification OTP**.
3. The code is **emailed** to the address you entered (it can also be filled with the **Fill Dev OTP** button while
   the server is in development mode). Click **Verify & Initialize Organisation**.
4. Scan the QR code with your authenticator app (or type the secret under "Cannot scan?"), enter the 6-digit code,
   click **Verify Code & Enroll Device**.
5. Save the 10 recovery codes, then click **I have securely saved my recovery codes**.
6. Set your new administrator password (the temporary one is pre-filled), then **Update Password & Launch Sandesh**.

You are now the administrator: the top bar has **Approvals** and the shield icon (**Admin console**).

### 2 and 3. One branch and the departments
Admin console (shield icon) -> **Org Setup** tab.
- **Branches**: Name, City, PIN, then **Add Branch** (one branch, e.g. `Agile Labs HQ`, Pune).
- **Departments**: add `Tech`, `Projects`, `Sales`, `Admin`.
- **Designations**: add `Reporting Manager`, `Engineer`, `Analyst`. (People must pick a designation when they sign
  up, so these have to exist first.)

If the console asks you to unlock it, click **Send code**, enter your password and the emailed code.

### 4. Invite Sab (Tech) as reporting manager
Admin console -> **+ Invite User**:
- Full name `Sabarish`, his company email, mobile, User Type **Employee**.
- Branch, Department **Tech**, Designation **Reporting Manager**.
- Tick **Appoint this user as a Chat Host** and, under Employees, tick **Dept: Tech**.
- **Dispatch Onboarding Invitation**.

Sab receives an email ("You're invited to Connectum") with how to sign in. His **username** is the part of his email
before the `@`: find it in **Users & Hosts** (shown as `@username`). Gunn and Anish will need it in step 6.

### 5. Invite Bijaya (Sales) as reporting manager
Same as step 4 with Department **Sales**, Designation **Reporting Manager**, host tick **Dept: Sales**.
Note Bijaya's username for Anup's sign-up.

### 6. Gunn, Anish and Anup self-register
On the sign-in page click **Self Register** and fill in:
- Full name, a username (optional), email, mobile, a password (8+ characters, letters and a digit).
- Registration Type **Enterprise Employee**, Branch, Department, Designation.
- Gunn and Anish: Department **Tech**, Designation **Engineer**. Anup: Department **Sales**, Designation **Analyst**.
- A reporting manager can no longer be chosen at sign-up: the server ignores that field. An administrator sets it
  afterwards (`admin.user.update {username, reportingManager}`), or a host sets it when inviting someone.
  The host who covers the person (Sab for Tech, Bijaya for Sales) still receives the approval request.

Each sees "Pending Host / Admin Approval". The request goes to the host who covers them, not to the admin:
- **Sab** signs in, opens **Approvals** (top bar) and clicks **Allow Entry to Chat** for Gunn and Anish.
- **Bijaya** does the same for Anup.

First sign-in for an invited person (Sab, Bijaya) or an approved person: enter the username, scan the QR with an
authenticator app, enter the code, save the recovery codes, then sign in again with the username and a fresh code.

### 7. Check messaging
Gunn signs in, opens the **CHATS** tab on the left, searches `sab` and clicks him, types a message and presses
Enter. Sab opens **CHATS**, searches `gunn`, sees the message and replies. People can message their host.

## Part 2: the new features

All in the Admin console (shield icon), tab **Users & Hosts** unless noted.

- **Change someone's branch, department or designation**: **Change Placement** on their row, choose, **Save**.
  If their host no longer covers them you get a warning naming matching hosts. Tick *Switch to a host that covers
  the new placement* to move them automatically. The person gets a notice in their notification feed.
- **Change a person's host**: **Change Host**, choose a host, confirm. A warning appears if that host's scope does not
  normally cover the person (it is still allowed: it is an admin override).
- **Make someone a host, or edit what a host covers**: **Make Host** / **Edit Host Scope**.
- **Stop someone being a host**: untick *Chat Host* and **Save**. If they still have people, a panel asks who takes
  them over first, so nobody is left pointing at a non-host.
- **Deactivate a host**: click their **Active** badge. A panel lets you hand their people to another host in the same
  step (or decide later).
- **Move everyone from one department, branch or designation to another**: tab **Org Setup**, **Move people** on the
  item, choose the target, **Preview** (lists who will move), then **Move N**. Afterwards the empty item can be removed.
- **Activity** tab: every admin change with who did it, when (IST), and before -> after. Filter by username.
- **Approvals**: now available to hosts, not only admins.
- **Unlock** (strict mode): the console asks for your password plus an emailed one-time code, and asks again if the
  unlock lapses.
- **Email**: invitations and one-time codes are sent for real (see `EMAIL_SETUP.md`).
- **Sign-up form**: no reporting-manager choice (the server ignores it; see step 6).

## Part 3: good to know
- Self-registered people are not hosts and cannot give themselves host or user-management rights.
- The invitation email gives the person's username and how to sign in (enter the username, scan the QR code with an authenticator app). It contains no password: only administrators have one. If an invitation gets lost, an admin or the person's host can re-send it (`users.resend_invite`).
- If an approver is away, ask the admin to use **Change Host** for the person or to approve through a covering host.
