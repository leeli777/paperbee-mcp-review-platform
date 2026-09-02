import { PROJECT_FIELDS } from "@/lib/project-fields";

const DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "PaperBee AI Upload API",
    version: "1.0.0",
    description: "使用六十分钟有效、成功上传一次后立即失效的临时密钥，将科研项目材料提交到内部项目池。",
  },
  servers: [{ url: "https://paperbee.asia" }],
  paths: {
    "/api/external/projects": {
      post: {
        operationId: "uploadResearchProject",
        summary: "上传一个科研项目及其审核材料",
        security: [{ uploadToken: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["title", "field", "descriptionFile"],
                properties: {
                  title: { type: "string", maxLength: 140 },
                  field: {
                    type: "string",
                    enum: PROJECT_FIELDS,
                  },
                  summary: { type: "string", maxLength: 900 },
                  aiDisclosure: { type: "string" },
                  recommendedJournals: { type: "array", items: { type: "string" } },
                  aiSubmissionAdvice: { type: "string", maxLength: 1800 },
                  descriptionFile: { type: "string", format: "binary" },
                  aiReviewFile: { type: "string", format: "binary" },
                  paperFile: { type: "string", format: "binary" },
                  reproductionFile: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "项目创建成功",
            content: { "application/json": { schema: { type: "object", properties: { projectId: { type: "string" } } } } },
          },
          "400": { description: "字段或文件格式不符合要求" },
          "401": { description: "上传密钥无效、过期或已撤销" },
          "413": { description: "单个文件超过 25 MB" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      uploadToken: { type: "http", scheme: "bearer", bearerFormat: "PaperBee upload token" },
    },
  },
};

export async function GET() {
  return Response.json(DOCUMENT, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
