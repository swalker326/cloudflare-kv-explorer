import { defineConfig } from "@rspack/cli";
import path from "path";
import { readdirSync } from "fs";

const isProduction = process.env.NODE_ENV === "production";

// Get all Node.js built-in modules to mark as external
const nodeModules = readdirSync("node_modules")
  .filter((x) => x !== ".bin")
  .reduce((acc: Record<string, string>, mod) => {
    acc[mod] = `commonjs ${mod}`;
    return acc;
  }, {});

// VSCode extension config
export default defineConfig({
  name: "extension",
  target: "node",
  mode: isProduction ? "production" : "development",
  entry: {
    extension: "./src/extension.ts"
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    libraryTarget: "commonjs2",
    clean: true
  },
  externals: {
    vscode: "commonjs vscode",
    // Mark all node_modules as external for the extension
    ...nodeModules
  },
  resolve: {
    extensions: [".ts", ".js", ".json"],
    mainFields: ["main", "module"]
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: {
                syntax: "typescript",
                decorators: true
              },
              target: "es2020"
            },
            module: {
              type: "commonjs"
            }
          }
        }
      },
      {
        test: /\.node$/,
        use: "node-loader"
      }
    ]
  },
  plugins: [],
  optimization: {
    minimize: isProduction
  },
  devtool: isProduction ? false : "source-map"
});
