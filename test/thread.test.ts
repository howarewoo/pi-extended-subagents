import test from "node:test";
import assert from "node:assert/strict";
import {stripVTControlCharacters as strip} from "node:util";
import {AssistantMessageComponent, UserMessageComponent, ToolExecutionComponent, createReadToolDefinition, getMarkdownTheme, initTheme} from "@earendil-works/pi-coding-agent";
import {ProcessTerminal, TuiMainScreen, visibleWidth, wrapTextWithAnsi} from "@earendil-works/pi-tui";
import {fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
import {createNativeThread, nativeText} from "../src/thread.ts";
import type {DelegationCoordinator} from "../src/coordinator.ts";

test("native thread uses the main chat's exact user/assistant classes, formatting, cache and active-theme invalidation", t => {
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal()); t.mock.method(tui, "requestRender", () => {});
  const thread = createNativeThread({tui, cwd: process.cwd()});
  const userText = "# Review request\n\n1. inspect 中文 👩‍💻\n2. report findings";
  const assistant = fauxAssistantMessage([{type:"thinking",thinking:"Consider **constraints**",thinkingSignature:"PRIVATE_SIGNATURE"},
    {type:"text",text:"# Findings\n\n- **Clear result**\n- 中文 👩‍💻\n\n```ts\nconst answer = 42;\n```"}]);
  const messages: ReturnType<DelegationCoordinator["messages"]> = [{role:"user",timestamp:1,content:userText+"\x1b]52;c;secret\x07\x1b[91m"},assistant];
  const update = t.mock.method(AssistantMessageComponent.prototype, "updateContent");
  const output = thread.render("id/1", messages, undefined, undefined, 55);
  const updates = update.mock.callCount();
  assert.deepEqual(thread.render("id/1", messages, undefined, undefined, 55), output);
  assert.equal(update.mock.callCount(), updates, "unchanged native messages must reuse components/highlighting");
  const expected = [new UserMessageComponent(userText, getMarkdownTheme()),new AssistantMessageComponent(assistant,false,getMarkdownTheme())]
    .flatMap(component=>component.render(55).flatMap(line=>wrapTextWithAnsi(nativeText(line),55)));
  assert.deepEqual(output, expected, "actual public main-thread classes, not a formatter facsimile");
  assert.match(output.join("\n"), /\x1b\[38;/);
  assert.doesNotMatch(output.join("\n"), /\x1b\]133|\x1b\]52|\x1b\[91m|PRIVATE_SIGNATURE/);
  assert.ok(output.every(line=>visibleWidth(line)<=55));
  initTheme("light", false); thread.invalidate();
  const light = thread.render("id/1", messages, undefined, undefined, 55);
  assert.notDeepEqual(light, output, "native singleton theme and cached components must follow real theme changes");
  assert.match(strip(light.join("\n")), /const answer = 42/);
  const streamed = fauxAssistantMessage("Streaming **next**");
  assert.match(strip(thread.render("id/1", messages, streamed, undefined, 55).join("\n")), /Streaming next/);
  thread.clear(); initTheme("dark", false);
});

test("native builtin read rendering is identical to the actual public tool component and renderer-only definition", t => {
  initTheme("dark", false);
  const tui = new TuiMainScreen(new ProcessTerminal()); t.mock.method(tui, "requestRender", () => {});
  const cwd = process.cwd(), args = {path:"sample.ts"};
  const message = fauxAssistantMessage(fauxToolCall("read",args,{id:"read-call"}),{stopReason:"toolUse"});
  const result = {role:"toolResult" as const,toolName:"read",toolCallId:"read-call",timestamp:2,isError:false,
    content:[{type:"text" as const,text:"export const value = 42;\n// 中文 👩‍💻"}], details:{private:"OPAQUE_DETAILS"}};
  const thread = createNativeThread({tui,cwd});
  const output = thread.render("id/1",[message,result],undefined,undefined,55);
  const {renderShell,renderCall,renderResult} = createReadToolDefinition(cwd);
  const component = new ToolExecutionComponent("read","read-call",args,{showImages:false},{renderShell,renderCall,renderResult} as import("@earendil-works/pi-coding-agent").ToolRenderers,tui,cwd);
  component.setExpanded(true);component.setArgsComplete();component.updateResult({content:result.content,isError:false});
  const expected = component.render(55).flatMap(line=>wrapTextWithAnsi(nativeText(line),55));
  assert.deepEqual(output,expected);
  assert.match(strip(output.join("\n")),/export const value = 42/);
  assert.match(output.join("\n"),/\x1b\[/,"native syntax colors retained");
  assert.doesNotMatch(output.join("\n"),/OPAQUE_DETAILS/);
  const live = {toolCallId:"read-call",toolName:"read",args,content:[{type:"text",text:"PARTIAL_NATIVE_RESULT"}]};
  assert.match(strip(thread.render("id/2",[message],undefined,live,32).join("\n")),/PARTIAL_NATIVE_RESULT/);
  const final = strip(thread.render("id/2",[message,result],undefined,undefined,32).join("\n"));
  assert.match(final,/export const value/);assert.doesNotMatch(final,/PARTIAL_NATIVE_RESULT/);
  thread.clear();
});

test("native edit renders only recorded safe diff without completed-args filesystem previews; generic results hide opaque/image payloads", async t => {
  initTheme("dark",false);
  const tui = new TuiMainScreen(new ProcessTerminal());const redraw = t.mock.method(tui,"requestRender",()=>{});
  const completed = t.mock.method(ToolExecutionComponent.prototype,"setArgsComplete");
  const thread = createNativeThread({tui,cwd:process.cwd()});
  const edit = fauxAssistantMessage(fauxToolCall("edit",{path:"never-read-secret.ts",edits:[{oldText:"before",newText:"after"}]},{id:"edit-call"}),{stopReason:"toolUse"});
  const output = thread.render("id/1",[edit,{role:"toolResult",toolName:"edit",toolCallId:"edit-call",timestamp:2,isError:false,
    content:[{type:"text",text:"Successfully replaced text."}],details:{diff:"-1 before\n+1 after\x1b]52;c;PRIVATE\x07",firstChangedLine:1,secret:"OPAQUE_DETAILS"}}],undefined,undefined,55);
  assert.equal(completed.mock.callCount(),0,"edit must never trigger native cwd preview reads");
  await new Promise(resolve=>setImmediate(resolve));assert.equal(redraw.mock.callCount(),0,"recorded diff projection has no async preview or clock");
  const text = strip(output.join("\n"));assert.match(text,/before/);assert.match(text,/after/);
  assert.match(output.join("\n"),/\x1b\[/);assert.doesNotMatch(output.join("\n"),/PRIVATE|OPAQUE_DETAILS|\x1b\]52/);
  const generic = thread.render("other/1",[{role:"toolResult",toolName:"submit_result",toolCallId:"submit",timestamp:3,isError:true,
    content:[{type:"text",text:"ACTUAL FAILURE\x1b[2J\u202e"},{type:"image",mimeType:"image/png",data:"IMAGE_PAYLOAD"}],details:{signature:"PRIVATE_SIGNATURE"}}],undefined,undefined,32);
  assert.match(strip(generic.join("\n")),/ACTUAL FAILURE/);assert.match(strip(generic.join("\n")),/payload\s+omitted/);
  assert.doesNotMatch(generic.join("\n"),/PRIVATE_SIGNATURE|IMAGE_PAYLOAD|\x1b\[2J|\u202e/);
  assert.ok(generic.every(line=>visibleWidth(line)<=32));thread.clear();
});
