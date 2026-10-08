export type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  researchField: string;
  status: string;
  lastSeenAt: string | null;
};

export type Project = {
  id: string;
  publicCode: string;
  workId: string;
  workRevision: number;
  versionLabel: string;
  revisionSummary: string;
  workVersionCount: number;
  visibility: "internal" | "private";
  title: string;
  summary: string;
  field: string;
  status: string;
  reviewScope: string;
  aiDisclosure: string;
  recommendedJournals: string;
  aiSubmissionAdvice: string;
  ownerMemberId: string;
  ownerName: string;
  versionNumber: number | null;
  fileName: string | null;
  artifactKinds: string;
  artifactFiles: Record<string, string>;
  assignmentCount: number;
  hasActiveAssignment: boolean;
  activeReviewerName: string;
  myActiveAssignmentId: string | null;
  canAccessReviewMaterials: boolean;
  likeCount: number;
  likedByMe: boolean;
  tags: ProjectTag[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectTag = {
  id: string;
  projectId: string;
  name: string;
  likeCount: number;
  likedByMe: boolean;
};

export type Assignment = {
  id: string;
  status: string;
  scope: string;
  dueDate: string | null;
  projectId: string;
  projectTitle: string;
  projectField: string;
  projectSummary: string;
  ownerName: string;
  reviewId: string | null;
};

export type DownloadLog = {
  id: string;
  occurredAt: string;
  source: "web" | "chatgpt_mcp";
  action: string;
  outcome: string;
  denialReason: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectTitle: string | null;
  versionNumber: number | null;
  artifactKind: string | null;
  fileName: string | null;
  memberId: string;
  memberName: string;
  memberEmail: string;
};

export type BootstrapData = {
  member: Member;
  projects: Project[];
  members: Member[];
  assignments: Assignment[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  stats: { accessible: number; shared: number; mine: number; underReview: number; passed: number };
};

export type View = "space" | "overview" | "projects" | "reviews" | "members" | "downloads";
