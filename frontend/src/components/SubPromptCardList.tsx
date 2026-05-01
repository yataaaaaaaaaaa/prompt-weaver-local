import { useEffect, useMemo, useRef } from "react";
import { useCategoryItem } from "../stores/categoriesStore";
import { useCurrentImageStore } from "../stores/currentImageStore";
import { CategoryId } from "../utils/CategoryId";
import { SubPromptId } from "../utils/SubPromptId";
import SubPromptCard from "./SubPromptCard";

function getOffsetTopWithin(container: HTMLElement, element: HTMLElement): number {
    let offset = 0;
    let current: HTMLElement | null = element;
    while (current && current !== container) {
        offset += current.offsetTop;
        current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
    }
    return offset;
}

function scrollElementIntoContainer(container: HTMLElement, element: HTMLElement): void {
    const elementTop = getOffsetTopWithin(container, element);
    const elementBottom = elementTop + element.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (elementTop < viewTop) {
        container.scrollTop = elementTop;
        return;
    }

    if (elementBottom > viewBottom) {
        container.scrollTop = Math.max(0, elementBottom - container.clientHeight);
    }
}

export type SubPromptCardListProps = {
    categoryId: CategoryId;
};


export default function SubPromptCardList({ categoryId }: SubPromptCardListProps) {
    const { subPrompts } = useCategoryItem(categoryId);
    const currentMetadata = useCurrentImageStore((state) => state.metadata);
    const listRef = useRef<HTMLDivElement | null>(null);
    const promptElementByIdRef = useRef<Record<string, HTMLDivElement | null>>({});
    const previousSelectionIdRef = useRef<string | null>(null);
    const previousCountRef = useRef<number | null>(null);

    const selectedPromptId = useMemo(() => {
        const selection = currentMetadata?.selections.find((item) => CategoryId.from(item.category_name).equals(categoryId));
        if (!selection) {
            return null;
        }

        const matchingPrompt = subPrompts.find((prompt) => SubPromptId.from(prompt.text).equals(SubPromptId.from(selection.prompt_text)));
        return matchingPrompt ? SubPromptId.from(matchingPrompt.text).toString() : null;
    }, [categoryId, currentMetadata?.selections, subPrompts]);

    useEffect(() => {
        if (previousSelectionIdRef.current === selectedPromptId) {
            return;
        }

        previousSelectionIdRef.current = selectedPromptId;
        if (!selectedPromptId) {
            return;
        }

        const list = listRef.current;
        const promptElement = promptElementByIdRef.current[selectedPromptId];
        if (!list || !promptElement) {
            return;
        }

        scrollElementIntoContainer(list, promptElement);
    }, [selectedPromptId]);

    useEffect(() => {
        if (previousCountRef.current != null && subPrompts.length > previousCountRef.current) {
            const list = listRef.current;
            if (list) {
                list.scrollTop = list.scrollHeight;
            }
        }
        previousCountRef.current = subPrompts.length;
    }, [subPrompts.length]);

    return (
        <div className="prompt-list" ref={listRef}>
            {subPrompts.map((prompt) => {
                const promptId = SubPromptId.from(prompt.text);
                const promptKey = promptId.toString();
                return (
                    <div
                        key={prompt.text}
                        ref={(element) => {
                            promptElementByIdRef.current[promptKey] = element;
                        }}
                    >
                        <SubPromptCard id={promptId} categoryId={categoryId}></SubPromptCard>
                    </div>
                );
            })}
        </div>
    );

}
