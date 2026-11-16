import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { expect, test, vi } from "vitest";
import { ResizeHandle } from "./resize-handle.tsx";

type Props = Partial<React.ComponentProps<typeof ResizeHandle>>;

function Harness({ edge, ...rest }: Props & { edge?: "left" | "right" }) {
  const panel = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(20);
  return (
    <div ref={panel} data-testid="panel" style={{ position: "relative" }}>
      <ResizeHandle
        width={width}
        min={10}
        max={30}
        step={2}
        label="Resize"
        panel={panel}
        edge={edge}
        onResize={(rem) => setWidth(Math.min(30, Math.max(10, rem)))}
        {...rest}
      />
    </div>
  );
}

function boxed(left: number, right: number): void {
  (screen.getByTestId("panel") as HTMLElement).getBoundingClientRect = () => ({ left, right }) as DOMRect;
}

const handle = () => screen.getByRole("separator");

test("on the right edge, dragging right widens the panel", () => {
  const onResize = vi.fn();
  render(<Harness edge="right" onResize={onResize} />);
  boxed(100, 420);
  fireEvent.pointerDown(handle(), { pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 356 });
  expect(onResize).toHaveBeenLastCalledWith((356 - 100) / 16);
  fireEvent.pointerUp(handle());
  fireEvent.pointerMove(handle(), { clientX: 200 });
  expect(onResize).toHaveBeenCalledTimes(1);
});

test("on the right edge, ArrowRight widens, ArrowLeft narrows, Home and End set the limits", async () => {
  const user = userEvent.setup();
  render(<Harness edge="right" />);
  handle().focus();
  await user.keyboard("{ArrowRight}");
  expect(handle().getAttribute("aria-valuenow")).toBe("22");
  await user.keyboard("{ArrowLeft}{ArrowLeft}");
  expect(handle().getAttribute("aria-valuenow")).toBe("18");
  await user.keyboard("{Home}");
  expect(handle().getAttribute("aria-valuenow")).toBe("10");
  await user.keyboard("{ArrowLeft}");
  expect(handle().getAttribute("aria-valuenow")).toBe("10");
  await user.keyboard("{End}");
  expect(handle().getAttribute("aria-valuenow")).toBe("30");
  await user.keyboard("{ArrowRight}");
  expect(handle().getAttribute("aria-valuenow")).toBe("30");
});

test("the right-edge handle sits on the right side of the panel", () => {
  render(<Harness edge="right" />);
  expect(handle().className).toContain("right-0");
  expect(handle().className).not.toContain("left-0");
});

test("the left edge behaves as before", async () => {
  const user = userEvent.setup();
  const onResize = vi.fn();
  render(<Harness onResize={onResize} />);
  expect(handle().className).toContain("left-0");
  boxed(0, 1000);
  fireEvent.pointerDown(handle(), { pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 840 });
  expect(onResize).toHaveBeenLastCalledWith(10);
  fireEvent.pointerUp(handle());

  const { unmount } = render(<Harness />);
  unmount();
  render(<Harness />);
  const h = screen.getAllByRole("separator").at(-1) as HTMLElement;
  h.focus();
  await user.keyboard("{ArrowLeft}");
  expect(h.getAttribute("aria-valuenow")).toBe("22");
  await user.keyboard("{ArrowRight}{ArrowRight}");
  expect(h.getAttribute("aria-valuenow")).toBe("18");
});

test("double-click calls onReset", async () => {
  const onReset = vi.fn();
  render(<Harness edge="right" onReset={onReset} />);
  await userEvent.setup().dblClick(handle());
  expect(onReset).toHaveBeenCalledTimes(1);
});

test("dragging under collapseBelow calls onCollapse once and not onResize", () => {
  const onResize = vi.fn();
  const onCollapse = vi.fn();
  render(<Harness edge="right" collapseBelow={8} onResize={onResize} onCollapse={onCollapse} />);
  boxed(0, 320);
  fireEvent.pointerDown(handle(), { pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 200 });
  expect(onResize).toHaveBeenCalledTimes(1);
  fireEvent.pointerMove(handle(), { clientX: 100 });
  fireEvent.pointerMove(handle(), { clientX: 50 });
  expect(onCollapse).toHaveBeenCalledTimes(1);
  expect(onResize).toHaveBeenCalledTimes(1);
  fireEvent.pointerUp(handle());
  // A new drag can collapse again.
  fireEvent.pointerDown(handle(), { pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 10 });
  expect(onCollapse).toHaveBeenCalledTimes(2);
});

test("without collapseBelow a small width goes to onResize", () => {
  const onResize = vi.fn();
  render(<Harness edge="right" onResize={onResize} />);
  boxed(0, 320);
  fireEvent.pointerDown(handle(), { pointerId: 1 });
  fireEvent.pointerMove(handle(), { clientX: 16 });
  expect(onResize).toHaveBeenLastCalledWith(1);
});
