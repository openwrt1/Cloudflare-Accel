// 更新日期: 2025-08-25
// 更新内容:
// 1. 无论是否重定向，只要目标是 AWS S3，就自动补全 x-amz-content-sha256 和 x-amz-date
// 2. 改进Docker镜像路径处理逻辑，支持多种格式: 如 hello-world | library/hello-world | docker.io/library/hello-world
// 3. 解决大陆拉取第三方 Docker 镜像层失败的问题，自动递归处理所有 302/307 跳转，无论跳转到哪个域名，都由 Worker 继续反代，避免客户端直接访问被墙 CDN，从而提升拉取成功率
// 4. 感谢老王，处理了暗黑模式下，输入框的颜色显示问题
// 用户配置区域开始 =================================
// 以下变量用于配置代理服务的白名单和安全设置，可根据需求修改。

// ALLOWED_HOSTS: 定义允许代理的域名列表（默认白名单）。
// - 添加新域名：将域名字符串加入数组，如 'docker.io'。
// - 注意：仅支持精确匹配的域名（如 'github.com'），不支持通配符。
// - 只有列出的域名会被处理，未列出的域名将返回 400 错误。
// 示例：const ALLOWED_HOSTS = ['github.com', 'docker.io'];
const ALLOWED_HOSTS = [
  "quay.io",
  "gcr.io",
  "k8s.gcr.io",
  "registry.k8s.io",
  "ghcr.io",
  "docker.cloudsmith.io",
  "registry-1.docker.io",
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "gist.github.com",
  "gist.githubusercontent.com",
];

// RESTRICT_PATHS: 控制是否限制 GitHub 和 Docker 请求的路径。
// - 设置为 true：只允许 ALLOWED_PATHS 中定义的路径关键字。
// - 设置为 false：允许 ALLOWED_HOSTS 中的所有路径。
// 示例：const RESTRICT_PATHS = true;
const RESTRICT_PATHS = false;

// ALLOWED_PATHS: 定义 GitHub 和 Docker 的允许路径关键字。
// - 添加新关键字：加入数组，如 'user-id-3' 或 'my-repo'。
// - 用于匹配请求路径（如 'library' 用于 Docker Hub 官方镜像）。
// - 路径检查对大小写不敏感，仅当 RESTRICT_PATHS = true 时生效。
// 示例：const ALLOWED_PATHS = ['library', 'my-user', 'my-repo'];
const ALLOWED_PATHS = [
  "library", // Docker Hub 官方镜像仓库的命名空间
  "user-id-1",
  "user-id-2",
];

// 用户配置区域结束 =================================

async function handleToken(realm, service, scope) {
  const tokenUrl = `${realm}?service=${service}&scope=${scope}`;
  console.log(`Fetching token from: ${tokenUrl}`);
  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!tokenResponse.ok) {
      console.log(
        `Token request failed: ${tokenResponse.status} ${tokenResponse.statusText}`,
      );
      return null;
    }
    const tokenData = await tokenResponse.json();
    const token = tokenData.token || tokenData.access_token;
    if (!token) {
      console.log("No token found in response");
      return null;
    }
    console.log("Token acquired successfully");
    return token;
  } catch (error) {
    console.log(`Error fetching token: ${error.message}`);
    return null;
  }
}

function isAmazonS3(url) {
  try {
    return new URL(url).hostname.includes("amazonaws.com");
  } catch {
    return false;
  }
}

// 计算请求体的 SHA256 哈希值
async function calculateSHA256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 获取空请求体的 SHA256 哈希值
function getEmptyBodySHA256() {
  return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
}

async function handleRequest(request) {
  const MAX_REDIRECTS = 5; // 最大重定向次数
  const url = new URL(request.url);
  let path = url.pathname;

  // 记录请求信息
  console.log(`Request: ${request.method} ${path}`);

  // 处理 Docker V2 API 或 GitHub 代理请求
  let isV2Request = false;
  let v2RequestType = null; // 'manifests' or 'blobs'
  let v2RequestTag = null; // tag or digest
  if (path.startsWith("/v2/")) {
    isV2Request = true;
    path = path.replace("/v2/", "");

    // 解析 V2 API 请求类型和标签/摘要
    const pathSegments = path.split("/").filter((part) => part);
    if (pathSegments.length >= 3) {
      // 格式如: nginx/manifests/latest 或 nginx/blobs/sha256:xxx
      v2RequestType = pathSegments[pathSegments.length - 2];
      v2RequestTag = pathSegments[pathSegments.length - 1];
      // 提取镜像名称部分（去掉 manifests/tag 或 blobs/digest 部分）
      path = pathSegments.slice(0, pathSegments.length - 2).join("/");
    }
  }

  // 提取目标域名和路径
  const pathParts = path.split("/").filter((part) => part);
  if (pathParts.length < 1) {
    return new Response("Invalid request: target domain or path required\n", {
      status: 400,
    });
  }

  let targetDomain,
    targetPath,
    isDockerRequest = false;

  // 检查路径是否以 https:// 或 http:// 开头
  const fullPath = path.startsWith("/") ? path.substring(1) : path;

  if (fullPath.startsWith("https://") || fullPath.startsWith("http://")) {
    // 处理 /https://domain.com/... 或 /http://domain.com/... 格式
    const urlObj = new URL(fullPath);
    targetDomain = urlObj.hostname;
    targetPath = urlObj.pathname.substring(1) + urlObj.search; // 移除开头的斜杠

    // 检查是否为 Docker 请求
    isDockerRequest = [
      "quay.io",
      "gcr.io",
      "k8s.gcr.io",
      "registry.k8s.io",
      "ghcr.io",
      "docker.cloudsmith.io",
      "registry-1.docker.io",
      "docker.io",
    ].includes(targetDomain);

    // 处理 docker.io 域名，转换为 registry-1.docker.io
    if (targetDomain === "docker.io") {
      targetDomain = "registry-1.docker.io";
    }
  } else {
    // 处理 Docker 镜像路径的多种格式
    if (pathParts[0] === "docker.io") {
      // 处理 docker.io/library/nginx 或 docker.io/amilys/embyserver 格式
      isDockerRequest = true;
      targetDomain = "registry-1.docker.io";

      if (pathParts.length === 2) {
        // 处理 docker.io/nginx 格式，添加 library 命名空间
        targetPath = `library/${pathParts[1]}`;
      } else {
        // 处理 docker.io/amilys/embyserver 或 docker.io/library/nginx 格式
        targetPath = pathParts.slice(1).join("/");
      }
    } else if (ALLOWED_HOSTS.includes(pathParts[0])) {
      // Docker 镜像仓库（如 ghcr.io）或 GitHub 域名（如 github.com）
      targetDomain = pathParts[0];
      targetPath = pathParts.slice(1).join("/") + url.search;
      isDockerRequest = [
        "quay.io",
        "gcr.io",
        "k8s.gcr.io",
        "registry.k8s.io",
        "ghcr.io",
        "docker.cloudsmith.io",
        "registry-1.docker.io",
      ].includes(targetDomain);
    } else if (pathParts.length >= 1 && pathParts[0] === "library") {
      // 处理 library/nginx 格式
      isDockerRequest = true;
      targetDomain = "registry-1.docker.io";
      targetPath = pathParts.join("/");
    } else if (pathParts.length >= 2) {
      // 处理 amilys/embyserver 格式（带命名空间但不是 library）
      isDockerRequest = true;
      targetDomain = "registry-1.docker.io";
      targetPath = pathParts.join("/");
    } else {
      // 处理单个镜像名称，如 nginx
      isDockerRequest = true;
      targetDomain = "registry-1.docker.io";
      targetPath = `library/${pathParts.join("/")}`;
    }
  }

  // 默认白名单检查：只允许 ALLOWED_HOSTS 中的域名
  if (!ALLOWED_HOSTS.includes(targetDomain)) {
    console.log(`Blocked: Domain ${targetDomain} not in allowed list`);
    return new Response(`Error: Invalid target domain.\n`, { status: 400 });
  }

  // 路径白名单检查（仅当 RESTRICT_PATHS = true 时）
  if (RESTRICT_PATHS) {
    const checkPath = isDockerRequest ? targetPath : path;
    console.log(`Checking whitelist against path: ${checkPath}`);
    const isPathAllowed = ALLOWED_PATHS.some((pathString) =>
      checkPath.toLowerCase().includes(pathString.toLowerCase()),
    );
    if (!isPathAllowed) {
      console.log(`Blocked: Path ${checkPath} not in allowed paths`);
      return new Response(`Error: The path is not in the allowed paths.\n`, {
        status: 403,
      });
    }
  }

  // 构建目标 URL
  let targetUrl;
  if (isDockerRequest) {
    if (isV2Request && v2RequestType && v2RequestTag) {
      // 重构 V2 API URL
      targetUrl = `https://${targetDomain}/v2/${targetPath}/${v2RequestType}/${v2RequestTag}`;
    } else {
      targetUrl = `https://${targetDomain}/${isV2Request ? "v2/" : ""}${targetPath}`;
    }
  } else {
    targetUrl = `https://${targetDomain}/${targetPath}`;
  }

  const newRequestHeaders = new Headers(request.headers);
  newRequestHeaders.set("Host", targetDomain);
  newRequestHeaders.delete("x-amz-content-sha256");
  newRequestHeaders.delete("x-amz-date");
  newRequestHeaders.delete("x-amz-security-token");
  newRequestHeaders.delete("x-amz-user-agent");

  if (isAmazonS3(targetUrl)) {
    newRequestHeaders.set("x-amz-content-sha256", getEmptyBodySHA256());
    newRequestHeaders.set(
      "x-amz-date",
      new Date().toISOString().replace(/[-:T]/g, "").slice(0, -5) + "Z",
    );
  }

  try {
    // 尝试直接请求（注意：使用 manual 重定向以便我们能拦截到 307 并自己请求 S3）
    let response = await fetch(targetUrl, {
      method: request.method,
      headers: newRequestHeaders,
      body: request.body,
      redirect: "manual",
    });
    console.log(`Initial response: ${response.status} ${response.statusText}`);

    // 处理 Docker 认证挑战
    if (isDockerRequest && response.status === 401) {
      const wwwAuth = response.headers.get("WWW-Authenticate");
      if (wwwAuth) {
        const authMatch = wwwAuth.match(
          /Bearer realm="([^"]+)",service="([^"]*)",scope="([^"]*)"/,
        );
        if (authMatch) {
          const [, realm, service, scope] = authMatch;
          console.log(
            `Auth challenge: realm=${realm}, service=${service || targetDomain}, scope=${scope}`,
          );

          const token = await handleToken(
            realm,
            service || targetDomain,
            scope,
          );
          if (token) {
            const authHeaders = new Headers(request.headers);
            authHeaders.set("Authorization", `Bearer ${token}`);
            authHeaders.set("Host", targetDomain);
            // 如果目标是 S3，添加必要的 x-amz 头；否则删除可能干扰的头部
            if (isAmazonS3(targetUrl)) {
              authHeaders.set("x-amz-content-sha256", getEmptyBodySHA256());
              authHeaders.set(
                "x-amz-date",
                new Date().toISOString().replace(/[-:T]/g, "").slice(0, -5) +
                  "Z",
              );
            } else {
              authHeaders.delete("x-amz-content-sha256");
              authHeaders.delete("x-amz-date");
              authHeaders.delete("x-amz-security-token");
              authHeaders.delete("x-amz-user-agent");
            }

            const authRequest = new Request(targetUrl, {
              method: request.method,
              headers: authHeaders,
              body: request.body,
              redirect: "manual",
            });
            console.log("Retrying with token");
            response = await fetch(authRequest);
            console.log(
              `Token response: ${response.status} ${response.statusText}`,
            );
          } else {
            console.log("No token acquired, falling back to anonymous request");
            const anonHeaders = new Headers(request.headers);
            anonHeaders.delete("Authorization");
            anonHeaders.set("Host", targetDomain);
            // 如果目标是 S3，添加必要的 x-amz 头；否则删除可能干扰的头部
            if (isAmazonS3(targetUrl)) {
              anonHeaders.set("x-amz-content-sha256", getEmptyBodySHA256());
              anonHeaders.set(
                "x-amz-date",
                new Date().toISOString().replace(/[-:T]/g, "").slice(0, -5) +
                  "Z",
              );
            } else {
              anonHeaders.delete("x-amz-content-sha256");
              anonHeaders.delete("x-amz-date");
              anonHeaders.delete("x-amz-security-token");
              anonHeaders.delete("x-amz-user-agent");
            }

            const anonRequest = new Request(targetUrl, {
              method: request.method,
              headers: anonHeaders,
              body: request.body,
              redirect: "manual",
            });
            response = await fetch(anonRequest);
            console.log(
              `Anonymous response: ${response.status} ${response.statusText}`,
            );
          }
        } else {
          console.log("Invalid WWW-Authenticate header");
        }
      } else {
        console.log("No WWW-Authenticate header in 401 response");
      }
    }

    // 处理 S3 重定向（Docker 镜像层）
    if (
      isDockerRequest &&
      (response.status === 307 || response.status === 302)
    ) {
      const redirectUrl = response.headers.get("Location");
      if (redirectUrl) {
        console.log(`Redirect detected: ${redirectUrl}`);
        const EMPTY_BODY_SHA256 = getEmptyBodySHA256();
        const redirectHeaders = new Headers(request.headers);
        redirectHeaders.set("Host", new URL(redirectUrl).hostname);

        // 对于任何重定向，都添加必要的AWS头（如果需要）
        if (isAmazonS3(redirectUrl)) {
          redirectHeaders.set("x-amz-content-sha256", EMPTY_BODY_SHA256);
          redirectHeaders.set(
            "x-amz-date",
            new Date().toISOString().replace(/[-:T]/g, "").slice(0, -5) + "Z",
          );
        }

        if (response.headers.get("Authorization")) {
          redirectHeaders.set(
            "Authorization",
            response.headers.get("Authorization"),
          );
        }

        const redirectRequest = new Request(redirectUrl, {
          method: request.method,
          headers: redirectHeaders,
          body: request.body,
          redirect: "manual",
        });
        response = await fetch(redirectRequest);
        console.log(
          `Redirect response: ${response.status} ${response.statusText}`,
        );

        if (!response.ok) {
          console.log(
            "Redirect request failed, returning original redirect response",
          );
          return new Response(response.body, {
            status: response.status,
            headers: response.headers,
          });
        }
      }
    }

    // 复制响应并添加 CORS 头
    const newResponse = new Response(response.body, response);
    newResponse.headers.set("Access-Control-Allow-Origin", "*");
    newResponse.headers.set(
      "Access-Control-Allow-Methods",
      "GET, HEAD, POST, OPTIONS",
    );
    if (isDockerRequest) {
      newResponse.headers.set(
        "Docker-Distribution-API-Version",
        "registry/2.0",
      );
      // 删除可能存在的重定向头，确保所有请求都通过Worker处理
      newResponse.headers.delete("Location");
    }
    return newResponse;
  } catch (error) {
    console.log(`Fetch error: ${error.message}`);
    return new Response(
      `Error fetching from ${targetDomain}: ${error.message}\n`,
      { status: 500 },
    );
  }
}

export async function onRequest(context) {
  // context.request 是传入的请求
  return await handleRequest(context.request);
}
