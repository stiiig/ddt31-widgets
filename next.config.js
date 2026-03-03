/** @type {import('next').NextConfig} */
const repo =
  process.env.GITHUB_REPOSITORY?.split("/")[1] ||
  process.env.NEXT_PUBLIC_REPO_NAME ||
  "";

const isGitHubActions = !!process.env.GITHUB_ACTIONS;

const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },

  ...(isGitHubActions && repo
    ? {
        basePath: `/${repo}`,
        assetPrefix: `/${repo}/`,
      }
    : {}),
};

module.exports = nextConfig;
