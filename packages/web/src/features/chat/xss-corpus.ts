/** One hostile input. `absent` must not appear in the HTML (any case); `present` must. */
export type XssCase = {
  name: string;
  markdown: string;
  absent: string[];
  present: string[];
};

/** Shared by the unit tests and, later, the end-to-end tests. */
export const XSS_CORPUS: readonly XssCase[] = [
  {
    name: "script tag",
    markdown: "before <script>alert(1)</script> after",
    absent: ["<script", "alert(1)"],
    present: ["before", "after"],
  },
  {
    name: "img onerror",
    markdown: 'before <img src=x onerror="alert(1)"> after',
    absent: ["<img", "onerror", "alert(1)"],
    present: ["before", "after"],
  },
  {
    name: "svg onload",
    markdown: 'before <svg onload="alert(1)"><circle r="5"/></svg> after',
    absent: ["<svg", "onload", "alert(1)"],
    present: ["before", "after"],
  },
  {
    name: "iframe",
    markdown: 'before <iframe src="https://example.com/x"></iframe> after',
    absent: ["<iframe", "example.com/x"],
    present: ["before", "after"],
  },
  {
    name: "style tag",
    markdown: "before <style>body{display:none}</style> after",
    absent: ["<style", "display:none"],
    present: ["before", "after"],
  },
  {
    name: "style attribute",
    markdown: '<p style="position:fixed;inset:0">covering</p>',
    absent: ["style=", "position:fixed"],
    present: ["covering"],
  },
  {
    name: "form and input",
    markdown: '<form action="https://example.com/steal"><input name="pw" type="password"><button>go</button></form> tail',
    absent: ["<form", "<input", "<button", "example.com/steal"],
    present: ["tail"],
  },
  {
    name: "javascript link",
    markdown: "[click me](javascript:alert(1))",
    absent: ["javascript:", "alert(1)"],
    present: ["click me"],
  },
  {
    name: "javascript link in capitals",
    markdown: "[click me](JAVASCRIPT:alert(1))",
    absent: ["javascript:", "alert(1)"],
    present: ["click me"],
  },
  {
    name: "javascript link with an encoded tab",
    markdown: "[click me](java&#x09;script:alert(1))",
    absent: ["javascript:", "java\tscript:", "alert(1)"],
    present: ["click me"],
  },
  {
    name: "javascript link in raw html",
    markdown: '<a href="javascript:alert(1)">click me</a>',
    absent: ["javascript:", "alert(1)"],
    present: ["click me"],
  },
  {
    name: "data link",
    markdown: "[click me](data:text/html,<script>alert(1)</script>)",
    absent: ["data:", "<script", "alert(1)"],
    present: ["click me"],
  },
  {
    name: "javascript autolink",
    markdown: "<javascript:alert(1)>",
    absent: ["href=\"javascript:", "alert(1)\""],
    present: [],
  },
  {
    name: "remote image",
    markdown: "see ![remote](https://example.com/a.png) here",
    absent: ["<img", "example.com/a.png"],
    present: ["see", "here"],
  },
  {
    name: "vbscript link",
    markdown: '<a href="vbscript:msgbox(1)">click me</a>',
    absent: ["vbscript:", "msgbox"],
    present: ["click me"],
  },
  {
    name: "file link",
    markdown: "[click me](file:///etc/passwd)",
    absent: ["file:", "/etc/passwd"],
    present: ["click me"],
  },
  {
    name: "math",
    markdown: "before <math><mi xlink:href=\"data:x,<script>alert(1)</script>\">x</mi></math> after",
    absent: ["<math", "<script", "alert(1)"],
    present: ["before", "after"],
  },
  {
    name: "base href",
    markdown: '<base href="https://example.com/"> [rel](/path)',
    absent: ["<base", "example.com"],
    present: ["rel"],
  },
  {
    name: "meta refresh",
    markdown: '<meta http-equiv="refresh" content="0;url=https://example.com/"> text',
    absent: ["<meta", "refresh", "example.com"],
    present: ["text"],
  },
  {
    name: "noscript mutation",
    markdown: '<noscript><p title="</noscript><img src=x onerror=alert(1)>">tail</p></noscript>',
    absent: ["<img", "onerror=", "<noscript"],
    present: [],
  },
  {
    name: "nested forms and tables",
    markdown: "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>",
    absent: ["<img", "onerror", "<style", "<form", "<math"],
    present: [],
  },
  {
    name: "html comment and cdata",
    markdown: "a <!--><script>alert(1)</script>--> b <![CDATA[<script>alert(2)</script>]]>",
    absent: ["<script", "<!--", "<![cdata"],
    present: [],
  },
  {
    name: "event handler on a link",
    markdown: '<a href="https://example.com" onclick="alert(1)" onmouseover="alert(2)">link</a>',
    absent: ["onclick", "onmouseover", "alert("],
    present: ["link"],
  },
];
