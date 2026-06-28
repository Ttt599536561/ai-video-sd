import { ZodError } from "zod";

export interface AppErrorResponse {
  error: string;
  code: string;
  message: string;
  statusCode: number;
  details?: unknown;
}

interface ErrorDefinition {
  code: string;
  message: string;
  statusCode: number;
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

const knownErrors: Array<[RegExp, ErrorDefinition]> = [
  [/^Unauthorized$/i, { code: "AUTH_REQUIRED", message: "请先登录后再继续操作", statusCode: 401 }],
  [/^Forbidden$/i, { code: "FORBIDDEN", message: "当前账号没有权限执行此操作", statusCode: 403 }],
  [/Admin bootstrap is disabled after an admin account exists/i, { code: "ADMIN_BOOTSTRAP_DISABLED", message: "管理员初始化入口已关闭，请使用已有管理员账号登录", statusCode: 400 }],
  [/User is banned/i, { code: "USER_BANNED", message: "账号已被封禁，请联系管理员", statusCode: 403 }],
  [/Invalid email or password/i, { code: "INVALID_CREDENTIALS", message: "邮箱或密码不正确", statusCode: 400 }],
  [/Email already exists/i, { code: "EMAIL_ALREADY_EXISTS", message: "该邮箱已注册，请直接登录", statusCode: 400 }],
  [/Invalid current password/i, { code: "INVALID_CURRENT_PASSWORD", message: "当前密码不正确", statusCode: 400 }],
  [/Password must be at least 8 characters/i, { code: "PASSWORD_TOO_SHORT", message: "密码至少需要 8 位", statusCode: 400 }],
  [/Invalid email/i, { code: "INVALID_EMAIL", message: "邮箱格式不正确", statusCode: 400 }],
  [/Insufficient credits/i, { code: "INSUFFICIENT_CREDITS", message: "积分不足，请先购买或兑换积分", statusCode: 400 }],
  [/Redemption code does not exist/i, { code: "REDEMPTION_CODE_NOT_FOUND", message: "兑换码不存在，请检查后重试", statusCode: 404 }],
  [/Redemption code has already been used/i, { code: "REDEMPTION_CODE_USED", message: "兑换码已被使用", statusCode: 400 }],
  [/Redemption code has expired/i, { code: "REDEMPTION_CODE_EXPIRED", message: "兑换码已过期", statusCode: 400 }],
  [/Redemption code has been voided/i, { code: "REDEMPTION_CODE_VOID", message: "兑换码已作废", statusCode: 400 }],
  [/Model already exists/i, { code: "MODEL_ALREADY_EXISTS", message: "模型已存在，请更换模型名称", statusCode: 400 }],
  [/Model not found/i, { code: "MODEL_NOT_FOUND", message: "模型不存在或已删除", statusCode: 404 }],
  [/Credit package not found/i, { code: "CREDIT_PACKAGE_NOT_FOUND", message: "积分套餐不存在或已删除", statusCode: 404 }],
  [/Purchase URL must use http or https/i, { code: "PURCHASE_URL_INVALID", message: "购买链接必须使用 HTTP 或 HTTPS", statusCode: 400 }],
  [/Credit balance cannot be negative/i, { code: "CREDIT_BALANCE_NEGATIVE", message: "积分调整后不能小于 0", statusCode: 400 }],
  [/User not found|User does not exist/i, { code: "USER_NOT_FOUND", message: "用户不存在", statusCode: 404 }],
  [/Provider URL must use https/i, { code: "PROVIDER_URL_INSECURE", message: "供应商地址必须使用 HTTPS", statusCode: 400 }],
  [/Provider URL cannot target private network addresses/i, { code: "PROVIDER_URL_PRIVATE", message: "供应商地址不能指向内网或本机地址", statusCode: 400 }],
  [/Default video provider is not configured|Video provider is not configured/i, { code: "PROVIDER_NOT_CONFIGURED", message: "视频供应商尚未配置", statusCode: 400 }],
  [/Public API base URL must use http or https|Public API base URL must be publicly reachable/i, { code: "PUBLIC_API_BASE_URL_INVALID", message: "公网 API 地址必须是供应商可访问的 HTTP 或 HTTPS 公网地址", statusCode: 400 }],
  [/Public API base URL is required/i, { code: "PUBLIC_API_BASE_URL_REQUIRED", message: "上传参考素材需要配置公网 API 地址 PUBLIC_API_BASE_URL", statusCode: 400 }],
  [/Public API reference media URL is not reachable/i, { code: "PUBLIC_API_REFERENCE_URL_UNREACHABLE", message: "公网 API 地址无法访问刚上传的参考素材，请检查域名是否指向当前后端并代理 /api/ 路径", statusCode: 400 }],
  [/Provider quota is blocked|insufficient_user_quota|最低保留额度/i, { code: "PROVIDER_QUOTA_BLOCKED", message: "供应商额度不足或最低保留额度限制未解除，已阻止真实生成请求", statusCode: 409 }],
  [/x509: certificate has expired|tls: failed to verify certificate|certificate.*expired|certificate.*not yet valid/i, { code: "PUBLIC_API_BASE_URL_CERT_INVALID", message: "公网 API 地址的 HTTPS 证书已过期或无法验证，请更新域名证书后再生成", statusCode: 400 }],
  [/Provider request failed/i, { code: "PROVIDER_UNAVAILABLE", message: "视频供应商暂时不可用，请稍后重试", statusCode: 502 }],
  [/Reference image too large/i, { code: "REFERENCE_IMAGE_TOO_LARGE", message: "参考图片过大，请压缩图片后重试", statusCode: 400 }],
  [/Body cannot exceed|Request body is too large|body limit/i, { code: "REQUEST_BODY_TOO_LARGE", message: "上传素材过大，请压缩后重试或减少参考素材数量", statusCode: 413 }],
  [/Video asset has expired/i, { code: "VIDEO_ASSET_EXPIRED", message: "视频文件已过期，请重新生成", statusCode: 410 }],
  [/Video asset not found/i, { code: "VIDEO_ASSET_NOT_FOUND", message: "视频文件不存在或已清理", statusCode: 404 }],
  [/Video job not found/i, { code: "VIDEO_JOB_NOT_FOUND", message: "视频任务不存在", statusCode: 404 }],
  [/Duration must be between 5 and 15 seconds/i, { code: "INVALID_DURATION", message: "视频时长必须在 5 到 15 秒之间", statusCode: 400 }],
  [/Invalid operation/i, { code: "INVALID_OPERATION", message: "当前任务状态不支持此操作", statusCode: 400 }]
];

export function toAppErrorResponse(error: unknown): AppErrorResponse {
  if (error instanceof AppError) {
    return {
      error: error.message,
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      details: error.details
    };
  }

  if (error instanceof ZodError) {
    return {
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      message: "请求参数不正确，请检查后重试",
      statusCode: 400,
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    };
  }

  const rawMessage = error instanceof Error ? error.message : "Internal server error";
  const definition = knownErrors.find(([pattern]) => pattern.test(rawMessage))?.[1] ?? {
    code: "INTERNAL_ERROR",
    message: "服务暂时不可用，请稍后重试",
    statusCode: 500
  };

  return {
    error: rawMessage,
    code: definition.code,
    message: definition.message,
    statusCode: definition.statusCode
  };
}
