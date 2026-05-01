import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ForbiddenAssociationEndpoint, ForbiddenMatcher, ForbiddenRule } from '../types';
import { normalizeTagId } from '../utils';
import { createFileBackedStorage } from '../utils/createFileBackedStorage';

type ForbiddenAssociationsStore = {
    rules: ForbiddenRule[];
    setRules: (rules: ForbiddenRule[]) => void;
    addRule: (rule: ForbiddenRule) => void;
    removeRule: (predicate: (rule: ForbiddenRule) => boolean) => void;
    toggleSelectionAssociation: (source: ForbiddenAssociationEndpoint, target: ForbiddenAssociationEndpoint) => void;
    hasAssociation: (source: ForbiddenAssociationEndpoint, target: ForbiddenAssociationEndpoint) => boolean;
};

function promptMatcher(selection: ForbiddenAssociationEndpoint['selection']): ForbiddenMatcher {
    return { kind: 'specific', category_name: selection.category_name, prompt_text: selection.prompt_text, contains_text: null, tag_text: null };
}

function categoryMatcher(selection: ForbiddenAssociationEndpoint['selection']): ForbiddenMatcher {
    return { kind: 'specific', category_name: selection.category_name, prompt_text: null, contains_text: null, tag_text: null };
}

function tagMatcher(selection: ForbiddenAssociationEndpoint['selection'], tagText: string | null | undefined): ForbiddenMatcher {
    return {
        kind: 'tag',
        category_name: selection.category_name,
        prompt_text: null,
        contains_text: null,
        tag_text: normalizeTagId(tagText ?? ''),
    };
}

function matcherEquals(left: ForbiddenMatcher, right: ForbiddenMatcher): boolean {
    return left.kind === right.kind
        && left.category_name === right.category_name
        && left.prompt_text === right.prompt_text
        && left.contains_text === right.contains_text
        && normalizeTagId(left.tag_text ?? '') === normalizeTagId(right.tag_text ?? '');
}

function endpointMatcher(endpoint: ForbiddenAssociationEndpoint): ForbiddenMatcher {
    if (endpoint.mode === 'prompt') {
        return promptMatcher(endpoint.selection);
    }
    if (endpoint.mode === 'category') {
        return categoryMatcher(endpoint.selection);
    }
    return tagMatcher(endpoint.selection, endpoint.tag_text);
}

function makeRule(source: ForbiddenAssociationEndpoint, target: ForbiddenAssociationEndpoint): ForbiddenRule {
    return {
        left: endpointMatcher(source),
        right: endpointMatcher(target),
    };
}

function ruleEquals(left: ForbiddenRule, right: ForbiddenRule): boolean {
    return (matcherEquals(left.left, right.left) && matcherEquals(left.right, right.right))
        || (matcherEquals(left.left, right.right) && matcherEquals(left.right, right.left));
}

export const useForbiddenAssociationsStore = create<ForbiddenAssociationsStore>()(
    persist(
        (set, get) => ({
            rules: [],
            setRules: (rules) => set({ rules }),
            addRule: (rule) => set((state) => ({ rules: state.rules.some((item) => ruleEquals(item, rule)) ? state.rules : [...state.rules, rule] })),
            removeRule: (predicate) => set((state) => ({ rules: state.rules.filter((rule) => !predicate(rule)) })),
            toggleSelectionAssociation: (source, target) => {
                const nextRule = makeRule(source, target);
                const exists = get().rules.some((item) => ruleEquals(item, nextRule));
                set((state) => ({ rules: exists ? state.rules.filter((item) => !ruleEquals(item, nextRule)) : [...state.rules, nextRule] }));
            },
            hasAssociation: (source, target) => {
                const nextRule = makeRule(source, target);
                return get().rules.some((item) => ruleEquals(item, nextRule));
            },
        }),
        {
            name: 'forbidden-associations-store',
            storage: createJSONStorage(() => createFileBackedStorage('forbidden-associations-store')),
        },
    ),
);
