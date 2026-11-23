/**
 * Shapes of the task board ("Aufgaben" under Projekte). The rows are OALab Studio's own tables in the shared database
 * (`studio_tasks`, `studio_subtasks`, `studio_comments`, `studio_files`, `studio_activity`), so Studio and the hub show
 * the same cards: a card moved here stands in the same column in Studio. Type imports only, so tests load it directly.
 */

/** Studio's columns, in board order (the list of values lives in rules.ts). */
export type TaskStatus = "backlog" | "todo" | "progress" | "review" | "done";
export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

export type BoardPerson = {
  id: string;
  name: string;
  initials: string;
  /**
   * "team": an active OALab team member; "freelancer": a login of a freelancer working on one of the board's projects
   * (Studio accepts both as assignees, freelancers only in their projects); "other": known by name only (creator, author).
   */
  kind: "team" | "freelancer" | "other";
  /** Freelancers: the name of their freelancer entry (the company), for hover hints. */
  company?: string;
};

/** A freelancer (an entry of the user management of the kind „Freelancer“) as the board knows it. */
export type BoardFreelancer = {
  id: string;
  name: string;
  /** FL-…, the number of the entry. */
  number: string;
  /** Its logins: they are the people on the cards (assignees, authors). */
  loginIds: string[];
  /** Organisations of the customers it looks after (hub_freelancer_customers): it may work on their projects. */
  organizationIds: string[];
};

export type BoardProject = {
  id: string;
  name: string;
  organizationId: string;
  company: string;
  startedOn: string | null;
  dueOn: string | null;
  /** Studio's project status: planning, active, risk, hold, complete. */
  status: string;
  /** Freelancers working on the project (studio_project_freelancers): they see it and every task except „Nur Team“. */
  freelancerIds: string[];
  /** A project of oalab itself (its organization is the oalab one, plan „oalab als Unternehmen“): no customer sees it. */
  internal?: boolean;
};

export type BoardTask = {
  id: string;
  /** Studio's running number, e.g. 1031. */
  number: number;
  projectId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueOn: string | null;
  labels: string[];
  assigneeIds: string[];
  /** Released to the customer (Studio's client_visible): it then shows in the customer's project window. */
  visible: boolean;
  /** „Nur Team“ (team_only): freelancers never see it, nor its checklist, comments, images and history. */
  teamOnly: boolean;
  /** Studio's board_order: the place within the column. */
  order: number;
  /** Studio's row version; a change is written only while it still matches. */
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  comments: number;
  checklist: { done: number; total: number };
  files: number;
};

export type TaskBoardState = {
  /**
   * Who looks: the oalab team (every running project) or a freelancer (only the projects an admin put them on, without
   * „Nur Team“; no archiving, no choice of who sees a task). The database decides the same for every access.
   */
  viewer: "admin" | "freelancer";
  projects: BoardProject[];
  tasks: BoardTask[];
  /** Everybody the board names: the team and the projects' freelancers (assignable), creators or authors. */
  people: BoardPerson[];
  /**
   * Admins: every freelancer who looks after the customer of a project (the choice under „Beteiligte“). Freelancers:
   * those working on their own projects, without other customers.
   */
  freelancers: BoardFreelancer[];
  viewerId: string;
  /**
   * The session confirmed a code (aal2). Studio lets its team write only then, so without it the board is read-only
   * and offers „Mit Code bestätigen“ (a login whose second factor is off signs in with the password alone).
   */
  confirmed: boolean;
  error: string | null;
};

export type TaskSubtask = { id: string; title: string; done: boolean; order: number; version: number };
export type TaskComment = { id: string; authorId: string; body: string; createdAt: string };
export type TaskFile = { id: string; name: string; size: number; mimeType: string; createdBy: string; createdAt: string };
export type TaskEvent = { id: string; actorId: string | null; kind: string; createdAt: string };

/** What the task window loads when it opens: everything that is not on the card. */
export type TaskDetail = {
  taskId: string;
  description: string;
  subtasks: TaskSubtask[];
  comments: TaskComment[];
  files: TaskFile[];
  events: TaskEvent[];
};

/** `stale`: somebody changed the row in the meantime; the board reloads instead of overwriting. */
export type TaskResult<T> = { ok: true; data: T } | { ok: false; error: string; stale?: boolean };

/**
 * Who sees a task besides the oalab team (rules.ts writes it as team_only and client_visible): „Nur Team“, „+ Freelancer“
 * (the project's freelancers) or „+ Kunde“ (the freelancers and the customer in the project window).
 */
export type TaskAudience = "team" | "shared" | "customer";

/** The fields a card or the task window may change. Freelancers change everything except the audience. */
export type TaskPatch = {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  dueOn?: string | null;
  labels?: string[];
  assigneeIds?: string[];
  audience?: TaskAudience;
};
