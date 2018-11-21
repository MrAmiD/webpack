/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const { SyncWaterfallHook } = require("tapable");
const HotModuleReplacementPlugin = require("../HotModuleReplacementPlugin");
const MainTemplate = require("../MainTemplate");
const RuntimeGlobals = require("../RuntimeGlobals");
const JsonpChunkLoadingRuntimeModule = require("./JsonpChunkLoadingRuntimeModule");
const Template = require("../Template");

/** @typedef {import("../Chunk")} Chunk */
/** @typedef {import("../Compilation")} Compilation */
/** @typedef {import("../MainTemplate")} MainTemplate */

/**
 * @typedef {Object} JsonpMainTemplatePluginHooks
 * @property {SyncWaterfallHook<string, Chunk, string>} jsonpScript
 * @property {SyncWaterfallHook<string, Chunk, string>} linkPreload
 * @property {SyncWaterfallHook<string, Chunk, string>} linkPrefetch
 */

/** @type {WeakMap<MainTemplate, JsonpMainTemplatePluginHooks>} */
const mainTemplateHooksMap = new WeakMap();

class JsonpMainTemplatePlugin {
	/**
	 * @param {MainTemplate} mainTemplate the main template
	 * @returns {JsonpMainTemplatePluginHooks} hooks
	 */
	static getMainTemplateHooks(mainTemplate) {
		if (!(mainTemplate instanceof MainTemplate)) {
			throw new TypeError(
				"The 'mainTemplate' argument must be an instance of MainTemplate"
			);
		}
		let hooks = mainTemplateHooksMap.get(mainTemplate);
		if (hooks === undefined) {
			hooks = {
				jsonpScript: new SyncWaterfallHook(["source", "chunk", "hash"]),
				linkPreload: new SyncWaterfallHook(["source", "chunk", "hash"]),
				linkPrefetch: new SyncWaterfallHook(["source", "chunk", "hash"])
			};
			mainTemplateHooksMap.set(mainTemplate, hooks);
		}
		return hooks;
	}

	/**
	 * @param {Compilation} compilation the compilation
	 */
	constructor(compilation) {
		this.compilation = compilation;
	}

	/**
	 * @param {MainTemplate} mainTemplate the main template
	 * @returns {void}
	 */
	apply(mainTemplate) {
		const needChunkOnDemandLoadingCode = chunk => {
			for (const chunkGroup of chunk.groupsIterable) {
				if (chunkGroup.getNumberOfChildren() > 0) return true;
			}
			return false;
		};
		const needChunkLoadingCode = chunk => {
			for (const chunkGroup of chunk.groupsIterable) {
				if (chunkGroup.chunks.length > 1) return true;
				if (chunkGroup.getNumberOfChildren() > 0) return true;
			}
			return false;
		};
		const needEntryDeferringCode = chunk => {
			for (const chunkGroup of chunk.groupsIterable) {
				if (chunkGroup.chunks.length > 1) return true;
			}
			return false;
		};
		const needPrefetchingCode = chunk => {
			const allPrefetchChunks = chunk.getChildIdsByOrdersMap(
				this.compilation.chunkGraph,
				true
			).prefetch;
			return allPrefetchChunks && Object.keys(allPrefetchChunks).length;
		};

		const {
			jsonpScript,
			linkPreload,
			linkPrefetch
		} = JsonpMainTemplatePlugin.getMainTemplateHooks(mainTemplate);

		const { hotBootstrap } = HotModuleReplacementPlugin.getMainTemplateHooks(
			mainTemplate
		);

		jsonpScript.tap("JsonpMainTemplatePlugin", (_, chunk, hash) => {
			const crossOriginLoading = mainTemplate.outputOptions.crossOriginLoading;
			const chunkLoadTimeout = mainTemplate.outputOptions.chunkLoadTimeout;
			const jsonpScriptType = mainTemplate.outputOptions.jsonpScriptType;

			return Template.asString([
				"var script = document.createElement('script');",
				"var onScriptComplete;",
				jsonpScriptType
					? `script.type = ${JSON.stringify(jsonpScriptType)};`
					: "",
				"script.charset = 'utf-8';",
				`script.timeout = ${chunkLoadTimeout / 1000};`,
				`if (${RuntimeGlobals.scriptNonce}) {`,
				Template.indent(
					`script.setAttribute("nonce", ${RuntimeGlobals.scriptNonce});`
				),
				"}",
				`script.src = ${RuntimeGlobals.publicPath} + ${
					RuntimeGlobals.getChunkScriptFilename
				}(chunkId);`,
				crossOriginLoading
					? Template.asString([
							"if (script.src.indexOf(window.location.origin + '/') !== 0) {",
							Template.indent(
								`script.crossOrigin = ${JSON.stringify(crossOriginLoading)};`
							),
							"}"
					  ])
					: "",
				"onScriptComplete = function (event) {",
				Template.indent([
					"// avoid mem leaks in IE.",
					"script.onerror = script.onload = null;",
					"clearTimeout(timeout);",
					"var chunk = installedChunks[chunkId];",
					"if(chunk !== 0) {",
					Template.indent([
						"if(chunk) {",
						Template.indent([
							"var errorType = event && (event.type === 'load' ? 'missing' : event.type);",
							"var realSrc = event && event.target && event.target.src;",
							"var error = new Error('Loading chunk ' + chunkId + ' failed.\\n(' + errorType + ': ' + realSrc + ')');",
							"error.type = errorType;",
							"error.request = realSrc;",
							"chunk[1](error);"
						]),
						"}",
						"installedChunks[chunkId] = undefined;"
					]),
					"}"
				]),
				"};",
				"var timeout = setTimeout(function(){",
				Template.indent([
					"onScriptComplete({ type: 'timeout', target: script });"
				]),
				`}, ${chunkLoadTimeout});`,
				"script.onerror = script.onload = onScriptComplete;"
			]);
		});
		linkPreload.tap("JsonpMainTemplatePlugin", (_, chunk, hash) => {
			const crossOriginLoading = mainTemplate.outputOptions.crossOriginLoading;
			const jsonpScriptType = mainTemplate.outputOptions.jsonpScriptType;

			return Template.asString([
				"var link = document.createElement('link');",
				jsonpScriptType
					? `link.type = ${JSON.stringify(jsonpScriptType)};`
					: "",
				"link.charset = 'utf-8';",
				`if (${RuntimeGlobals.scriptNonce}) {`,
				Template.indent(
					`link.setAttribute("nonce", ${RuntimeGlobals.scriptNonce});`
				),
				"}",
				'link.rel = "preload";',
				'link.as = "script";',
				`link.href = ${RuntimeGlobals.publicPath} + ${
					RuntimeGlobals.getChunkScriptFilename
				}(chunkId);`,
				crossOriginLoading
					? Template.asString([
							"if (link.href.indexOf(window.location.origin + '/') !== 0) {",
							Template.indent(
								`link.crossOrigin = ${JSON.stringify(crossOriginLoading)};`
							),
							"}"
					  ])
					: ""
			]);
		});
		linkPrefetch.tap("JsonpMainTemplatePlugin", (_, chunk, hash) => {
			const crossOriginLoading = mainTemplate.outputOptions.crossOriginLoading;

			return Template.asString([
				"var link = document.createElement('link');",
				crossOriginLoading
					? `link.crossOrigin = ${JSON.stringify(crossOriginLoading)};`
					: "",
				`if (${RuntimeGlobals.scriptNonce}) {`,
				Template.indent(
					`link.setAttribute("nonce", ${RuntimeGlobals.scriptNonce});`
				),
				"}",
				'link.rel = "prefetch";',
				'link.as = "script";',
				`link.href = ${RuntimeGlobals.publicPath} + ${
					RuntimeGlobals.getChunkScriptFilename
				}(chunkId);`
			]);
		});

		mainTemplate.hooks.requireExtensions.tap(
			"JsonpMainTemplatePlugin",
			(source, { chunk }) => {
				if (!needChunkOnDemandLoadingCode(chunk)) return source;

				return Template.asString([
					source,
					"",
					"// on error function for async loading",
					`${
						RuntimeGlobals.uncaughtErrorHandler
					} = function(err) { console.error(err); throw err; };`
				]);
			}
		);

		this.compilation.hooks.runtimeRequirementInTree
			.for(RuntimeGlobals.ensureChunk)
			.tap("JsonpMainTemplatePlugin", (chunk, set) => {
				this.compilation.addRuntimeModule(
					chunk,
					new JsonpChunkLoadingRuntimeModule(
						chunk,
						this.compilation.chunkGraph,
						this.compilation.outputOptions,
						jsonpScript,
						linkPreload,
						linkPrefetch
					)
				);
			});

		mainTemplate.hooks.beforeStartup.tap(
			"JsonpMainTemplatePlugin",
			(source, chunk, hash) => {
				const chunkGraph = this.compilation.chunkGraph;
				const prefetchChunks = chunk.getChildIdsByOrders(chunkGraph).prefetch;
				if (
					needChunkLoadingCode(chunk) &&
					prefetchChunks &&
					prefetchChunks.length
				) {
					return Template.asString([
						source,
						`webpackJsonpCallback([[], {}, 0, ${JSON.stringify(
							prefetchChunks
						)}]);`
					]);
				}
				return source;
			}
		);
		mainTemplate.hooks.startup.tap(
			"JsonpMainTemplatePlugin",
			(source, { chunk, chunkGraph }) => {
				if (needEntryDeferringCode(chunk)) {
					return Template.asString([
						"// run deferred modules when ready",
						`return ${RuntimeGlobals.startup}();`
					]);
				}
				return source;
			}
		);
		hotBootstrap.tap("JsonpMainTemplatePlugin", (source, chunk, hash) => {
			const globalObject = mainTemplate.outputOptions.globalObject;
			const hotUpdateChunkFilename =
				mainTemplate.outputOptions.hotUpdateChunkFilename;
			const hotUpdateMainFilename =
				mainTemplate.outputOptions.hotUpdateMainFilename;
			const crossOriginLoading = mainTemplate.outputOptions.crossOriginLoading;
			const hotUpdateFunction = mainTemplate.outputOptions.hotUpdateFunction;
			const currentHotUpdateChunkFilename = mainTemplate.getAssetPath(
				JSON.stringify(hotUpdateChunkFilename),
				{
					hash: `" + ${mainTemplate.renderCurrentHashCode(hash)} + "`,
					hashWithLength: length =>
						`" + ${mainTemplate.renderCurrentHashCode(hash, length)} + "`,
					chunk: {
						id: '" + chunkId + "'
					}
				}
			);
			const currentHotUpdateMainFilename = mainTemplate.getAssetPath(
				JSON.stringify(hotUpdateMainFilename),
				{
					hash: `" + ${mainTemplate.renderCurrentHashCode(hash)} + "`,
					hashWithLength: length =>
						`" + ${mainTemplate.renderCurrentHashCode(hash, length)} + "`
				}
			);
			const runtimeSource = Template.getFunctionContent(
				require("./JsonpMainTemplate.runtime")
			)
				.replace(/\/\/\$semicolon/g, ";")
				.replace(
					/\$crossOriginLoading\$/g,
					crossOriginLoading ? JSON.stringify(crossOriginLoading) : "null"
				)
				.replace(/\$$publicPath$\$/g, RuntimeGlobals.publicPath)
				.replace(/\$hotMainFilename\$/g, currentHotUpdateMainFilename)
				.replace(/\$hotChunkFilename\$/g, currentHotUpdateChunkFilename)
				.replace(/\$hash\$/g, JSON.stringify(hash));
			return `${source}
function hotDisposeChunk(chunkId) {
	delete installedChunks[chunkId];
}
var parentHotUpdateCallback = ${globalObject}[${JSON.stringify(
				hotUpdateFunction
			)}];
${globalObject}[${JSON.stringify(hotUpdateFunction)}] = ${runtimeSource}`;
		});
		mainTemplate.hooks.hash.tap("JsonpMainTemplatePlugin", hash => {
			hash.update("jsonp");
			hash.update("6");
		});
	}
}
module.exports = JsonpMainTemplatePlugin;
