import { describe, expect, it } from "vitest";
import { toAppErrorResponse } from "../services/errors.js";

describe("toAppErrorResponse", () => {
  it("maps provider TLS certificate failures to a public API URL certificate error", () => {
    const response = toAppErrorResponse(
      new Error(
        'Provider request failed with HTTP 400: invalid image_urls[0]: fetch image url failed: Get "[REDACTED_URL]" tls: failed to verify certificate: x509: certificate has expired or is not yet valid'
      )
    );

    expect(response).toMatchObject({
      code: "PUBLIC_API_BASE_URL_CERT_INVALID",
      message: "公网 API 地址的 HTTPS 证书已过期或无法验证，请更新域名证书后再生成",
      statusCode: 400
    });
  });

  it("maps reference media public URL probe failures to a public API route error", () => {
    const response = toAppErrorResponse(
      new Error("Public API reference media URL is not reachable: HTTP 404")
    );

    expect(response).toMatchObject({
      code: "PUBLIC_API_REFERENCE_URL_UNREACHABLE",
      message: "公网 API 地址无法访问刚上传的参考素材，请检查域名是否指向当前后端并代理 /api/ 路径",
      statusCode: 400
    });
  });
});
