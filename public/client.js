// 动态获取当前域名
const currentDomain = window.location.hostname;

// 主题切换
function toggleTheme() {
  const body = document.body;
  const sun = document.querySelector(".sun");
  const moon = document.querySelector(".moon");
  if (body.classList.contains("light-mode")) {
    body.classList.remove("light-mode");
    body.classList.add("dark-mode");
    sun.classList.add("hidden");
    moon.classList.remove("hidden");
    localStorage.setItem("theme", "dark");
  } else {
    body.classList.remove("dark-mode");
    body.classList.add("light-mode");
    moon.classList.add("hidden");
    sun.classList.remove("hidden");
    localStorage.setItem("theme", "light");
  }
}

// 初始化主题
if (localStorage.getItem("theme") === "dark") {
  toggleTheme();
}

// 显示弹窗提示
function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove(isError ? "bg-green-500" : "bg-red-500");
  toast.classList.add(isError ? "bg-red-500" : "bg-green-500");
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// 复制文本的通用函数
function copyToClipboard(text) {
  // 尝试使用 navigator.clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch((err) => {
      console.error("Clipboard API failed:", err);
      return false;
    });
  }
  // 后备方案：使用 document.execCommand
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);
    return successful
      ? Promise.resolve()
      : Promise.reject(new Error("Copy command failed"));
  } catch (err) {
    document.body.removeChild(textarea);
    return Promise.reject(err);
  }
}

// GitHub 链接转换
let githubAcceleratedUrl = "";
function convertGithubUrl() {
  const input = document.getElementById("github-url").value.trim();
  const result = document.getElementById("github-result");
  const buttons = document.getElementById("github-buttons");
  if (!input) {
    showToast("请输入有效的 GitHub 链接", true);
    result.classList.add("hidden");
    buttons.classList.add("hidden");
    return;
  }
  if (!input.endsWith(".zip")) {
    showToast("仅支持 .zip 格式的 GitHub 文件链接", true);
    result.classList.add("hidden");
    buttons.classList.add("hidden");
    return;
  }
  if (!input.startsWith("https://")) {
    showToast("链接必须以 https:// 开头", true);
    result.classList.add("hidden");
    buttons.classList.add("hidden");
    return;
  }

  // 保持现有格式：域名/https://原始链接
  githubAcceleratedUrl =
    "https://" + currentDomain + "/https://" + input.substring(8);
  result.textContent = "加速链接: " + githubAcceleratedUrl;
  result.classList.remove("hidden");
  buttons.classList.remove("hidden");
  copyToClipboard(githubAcceleratedUrl)
    .then(() => {
      showToast("已复制到剪贴板");
    })
    .catch((err) => {
      showToast("复制失败: " + err.message, true);
    });
}

function copyGithubUrl() {
  copyToClipboard(githubAcceleratedUrl)
    .then(() => {
      showToast("已手动复制到剪贴板");
    })
    .catch((err) => {
      showToast("手动复制失败: " + err.message, true);
    });
}

function openGithubUrl() {
  showToast("Download has started!");
  window.open(githubAcceleratedUrl, "_blank");
}

// Git Clone 转换
let gitCommand = "";
function convertGitCloneUrl() {
  const input = document.getElementById("git-url").value.trim();
  const result = document.getElementById("git-result");
  const buttons = document.getElementById("git-buttons");
  if (!input) {
    showToast("请输入有效的 Git 仓库地址", true);
    result.classList.add("hidden");
    buttons.classList.add("hidden");
    return;
  }
  if (!input.startsWith("https://") || !input.endsWith(".git")) {
    showToast("请输入以 https:// 开头并以 .git 结尾的有效仓库地址", true);
    result.classList.add("hidden");
    buttons.classList.add("hidden");
    return;
  }

  // 格式: git clone https://<域名>/<原始git地址>
  const acceleratedGitUrl =
    "https://" + currentDomain + "/" + input.substring(8);
  gitCommand = "git clone " + acceleratedGitUrl;
  result.textContent = "加速命令: " + gitCommand;
  result.classList.remove("hidden");
  buttons.classList.remove("hidden");
  copyToClipboard(gitCommand)
    .then(() => {
      showToast("已复制到剪贴板");
    })
    .catch((err) => {
      showToast("复制失败: " + err.message, true);
    });
}

function copyGitCommand() {
  copyToClipboard(gitCommand)
    .then(() => showToast("已手动复制到剪贴板"))
    .catch((err) => showToast("手动复制失败: " + err.message, true));
}

// Docker 镜像转换
let dockerCommand = "";
function convertDockerImage() {
  const input = document.getElementById("docker-image").value.trim();
  const result = document.getElementById("docker-result");
  const buttons = document.getElementById("docker-buttons");
  if (!input) {
    showToast("请输入有效的镜像地址", true);
    result.classList.add("hidden");
    buttons.classList.add("hidden");
    return;
  }
  dockerCommand = "docker pull " + currentDomain + "/" + input;
  result.textContent = "加速命令: " + dockerCommand;
  result.classList.remove("hidden");
  buttons.classList.remove("hidden");
  copyToClipboard(dockerCommand)
    .then(() => {
      showToast("已复制到剪贴板");
    })
    .catch((err) => {
      showToast("复制失败: " + err.message, true);
    });
}

function copyDockerCommand() {
  copyToClipboard(dockerCommand)
    .then(() => {
      showToast("已手动复制到剪贴板");
    })
    .catch((err) => {
      showToast("手动复制失败: " + err.message, true);
    });
}
