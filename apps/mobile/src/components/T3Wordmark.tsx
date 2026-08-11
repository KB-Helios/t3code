import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

/**
 * The NorthBridgeCode "NB" brand mark, matching the desktop sidebar's T3Wordmark SVG
 * (apps/web Sidebar.tsx). Width derives from the viewBox aspect ratio.
 */
export function T3Wordmark(props: { readonly height: number; readonly color: ColorValue }) {
  const aspectRatio = 1;
  return (
    <Svg
      accessibilityLabel="NorthBridgeCode"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 128 128"
    >
      <Path
        d="M12 94V34L54 94V34"
        fill="none"
        stroke={props.color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={11}
      />
      <Path
        d="M70 34V94M70 34H94C105 34 112 40 112 49C112 58 105 64 94 64H70M70 64H96C107 64 114 70 114 79C114 88 107 94 96 94H70"
        fill="none"
        stroke={props.color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={11}
      />
    </Svg>
  );
}
