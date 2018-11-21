/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/

"use strict";

const RuntimeGlobals = require("../RuntimeGlobals");
const RuntimeModule = require("../RuntimeModule");
const getEntryInfo = require("./JsonpHelpers").getEntryInfo;
const Template = require("../Template");

class JsonpChunkLoadingRuntimeModule extends RuntimeModule {
	constructor(
		chunk,
		chunkGraph,
		outputOptions,
		jsonpScript,
		linkPreload,
		linkPrefetch
	) {
		super("jsonp chunk loading");
		this.chunk = chunk;
		this.chunkGraph = chunkGraph;
		this.outputOptions = outputOptions;
		this.jsonpScript = jsonpScript;
		this.linkPreload = linkPreload;
		this.linkPrefetch = linkPrefetch;
	}

	/**
	 * @returns {string} runtime code
	 */
	generate() {
		const {
			chunk,
			jsonpScript,
			linkPreload,
			linkPrefetch,
			chunkGraph,
			outputOptions
		} = this;
		const fn = RuntimeGlobals.ensureChunkHandlers;
		const needEntryDeferringCode = chunk => {
			for (const chunkGroup of chunk.groupsIterable) {
				if (chunkGroup.chunks.length > 1) return true;
			}
			return false;
		};
		const needPrefetchingCode = chunk => {
			const allPrefetchChunks = chunk.getChildIdsByOrdersMap(chunkGraph, true)
				.prefetch;
			return allPrefetchChunks && Object.keys(allPrefetchChunks).length;
		};
		const withDefer = needEntryDeferringCode(chunk);
		const withPrefetch = needPrefetchingCode(chunk);
		const chunkMap = chunk.getChildIdsByOrdersMap(chunkGraph).preload;
		const entries = getEntryInfo(chunkGraph, chunk);
		const jsonpObject = `${outputOptions.globalObject}[${JSON.stringify(
			outputOptions.jsonpFunction
		)}]`;
		return Template.asString([
			`var chunkPreloadMap = ${JSON.stringify(chunkMap, null, "\t")};`,
			"",
			"// object to store loaded and loading chunks",
			"// undefined = chunk not loaded, null = chunk preloaded/prefetched",
			"// Promise = chunk loading, 0 = chunk loaded",
			"var installedChunks = {",
			Template.indent(
				chunk.ids.map(id => `${JSON.stringify(id)}: 0`).join(",\n")
			),
			"};",
			"",
			withDefer
				? Template.asString([
						"var deferredModules = [",
						Template.indent(entries.map(e => JSON.stringify(e)).join(",\n")),
						"];"
				  ])
				: "",
			"",
			`(${fn} = ${fn} || []).push(function(chunkId, promises) {`,
			Template.indent([
				"var head = document.getElementsByTagName('head')[0];",
				"",
				chunkMap && Object.keys(chunkMap).length > 0
					? Template.asString([
							"// chunk preloading for javascript",
							`var chunkPreloadData = chunkPreloadMap[chunkId];`,
							"if(chunkPreloadData) {",
							Template.indent([
								"chunkPreloadData.forEach(function(chunkId) {",
								Template.indent([
									"if(installedChunks[chunkId] === undefined) {",
									Template.indent([
										"installedChunks[chunkId] = null;",
										linkPreload.call("", chunk),
										"head.appendChild(link);"
									]),
									"}"
								]),
								"});"
							]),
							"}"
					  ])
					: "// no chunk preloading needed",
				"",
				"// JSONP chunk loading for javascript",
				`var installedChunkData = installedChunks[chunkId];`,
				'if(installedChunkData !== 0) { // 0 means "already installed".',
				Template.indent([
					"",
					'// a Promise means "currently loading".',
					"if(installedChunkData) {",
					Template.indent(["promises.push(installedChunkData[2]);"]),
					"} else {",
					Template.indent([
						"// setup Promise in chunk cache",
						"var promise = new Promise(function(resolve, reject) {",
						Template.indent([
							`installedChunkData = installedChunks[chunkId] = [resolve, reject];`
						]),
						"});",
						"promises.push(installedChunkData[2] = promise);",
						"",
						"// start chunk loading",
						jsonpScript.call("", chunk),
						"head.appendChild(script);"
					]),
					"}"
				]),
				"}"
			]),
			"});",
			"",
			"// install a JSONP callback for chunk loading",
			"function webpackJsonpCallback(data) {",
			Template.indent([
				"var chunkIds = data[0];",
				"var moreModules = data[1];",
				withDefer ? "var executeModules = data[2];" : "",
				withPrefetch ? "var prefetchChunks = data[3] || [];" : "",
				'// add "moreModules" to the modules object,',
				'// then flag all "chunkIds" as loaded and fire callback',
				"var moduleId, chunkId, i = 0, resolves = [];",
				"for(;i < chunkIds.length; i++) {",
				Template.indent([
					"chunkId = chunkIds[i];",
					"if(installedChunks[chunkId]) {",
					Template.indent("resolves.push(installedChunks[chunkId][0]);"),
					"}",
					"installedChunks[chunkId] = 0;"
				]),
				"}",
				"for(moduleId in moreModules) {",
				Template.indent([
					"if(Object.prototype.hasOwnProperty.call(moreModules, moduleId)) {",
					Template.indent(
						`${
							RuntimeGlobals.moduleFactories
						}[moduleId] = moreModules[moduleId];`
					),
					"}"
				]),
				"}",
				"if(parentJsonpFunction) parentJsonpFunction(data);",
				withPrefetch
					? Template.asString([
							"// chunk prefetching for javascript",
							"var head = document.getElementsByTagName('head')[0];",
							"prefetchChunks.forEach(function(chunkId) {",
							Template.indent([
								"if(installedChunks[chunkId] === undefined) {",
								Template.indent([
									"installedChunks[chunkId] = null;",
									linkPrefetch.call("", chunk),
									"head.appendChild(link);"
								]),
								"}"
							]),
							"});"
					  ])
					: "",
				"while(resolves.length) {",
				Template.indent("resolves.shift()();"),
				"}",
				withDefer
					? Template.asString([
							"",
							"// add entry modules from loaded chunk to deferred list",
							"deferredModules.push.apply(deferredModules, executeModules || []);",
							"",
							"// run deferred modules when all chunks ready",
							"return checkDeferredModules();"
					  ])
					: ""
			]),
			"};",
			"",
			`var jsonpArray = ${jsonpObject} = ${jsonpObject} || [];`,
			"var oldJsonpFunction = jsonpArray.push.bind(jsonpArray);",
			"jsonpArray.push = webpackJsonpCallback;",
			"jsonpArray = jsonpArray.slice();",
			"for(var i = 0; i < jsonpArray.length; i++) webpackJsonpCallback(jsonpArray[i]);",
			"var parentJsonpFunction = oldJsonpFunction;",
			"",
			withDefer
				? Template.asString([
						"var checkDeferredModules = function() {};",
						"function checkDeferredModulesImpl() {",
						Template.indent([
							"var result;",
							"for(var i = 0; i < deferredModules.length; i++) {",
							Template.indent([
								"var deferredModule = deferredModules[i];",
								"var fulfilled = true;",
								"for(var j = 1; j < deferredModule.length; j++) {",
								Template.indent([
									"var depId = deferredModule[j];",
									"if(installedChunks[depId] !== 0) fulfilled = false;"
								]),
								"}",
								"if(fulfilled) {",
								Template.indent([
									"deferredModules.splice(i--, 1);",
									"result = " +
										"__webpack_require__(" +
										`${RuntimeGlobals.entryModuleId} = deferredModule[0]);`
								]),
								"}"
							]),
							"}",
							"return result;"
						]),
						"}",
						`${RuntimeGlobals.startup} = function() {`,
						Template.indent([
							"return (checkDeferredModules = checkDeferredModulesImpl)();"
						]),
						"};"
				  ])
				: ""
		]);
	}
}

module.exports = JsonpChunkLoadingRuntimeModule;
