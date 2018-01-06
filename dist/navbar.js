
define('text!qk-alchemy/components/layout/navbar.component.html',[],function () { return '<quark-component>\r\n    <div class="navbar navbar-default navbar-fixed-top" role="navigation" data-bind="onBind: init">\r\n        <div class="container-fluid">\r\n            <div class="navbar-header">\r\n                <button type="button" class="navbar-toggle" data-toggle="collapse" data-target=".navbar-collapse">\r\n                    <span class="sr-only">Desplegar menu</span>\r\n                    <span class="icon-bar"></span>\r\n                    <span class="icon-bar"></span>\r\n                    <span class="icon-bar"></span>\r\n                </button>\r\n                    <a data-bind="attr: { href: url }" class="navbar-brand">\r\n                        <!-- ko if: visibleIcon -->\r\n                            <!-- ko ifnot: iconType() == \'font\' -->\r\n                                <img data-bind="attr: { src: iconUrl }" />\r\n                            <!-- /ko -->\r\n                            <!-- ko if: iconType() == \'font\' -->\r\n                                <span class="font-icon" data-bind="css: iconUrl"></span>\r\n                            <!-- /ko -->\r\n                        <!-- /ko -->\r\n                        <span data-bind="text: model.brand"></span>\r\n                    </a>\r\n            </div>\r\n            <div class="collapse navbar-collapse">\r\n                <ul class="nav navbar-nav navbar-left">\r\n                    <!-- ko content: \'left\', virtual: true --><!-- /ko -->\r\n                </ul>\r\n\r\n                <ul class="nav navbar-nav navbar-right" style="padding-right: 15px;">\r\n                    <!-- ko content: \'right\', virtual: true --><!-- /ko -->\r\n                </ul>\r\n            </div>\r\n        </div>\r\n    </div>\r\n</quark-component>\r\n';});

define('qk-alchemy/lib/utils',[
    'quark',
    'knockout'
], function($$, ko) {
    function Utils() {
        var self = this;

        this.findContainer = function(context, type) {
            // Get the context container
            var container = context.$container;

            var found = false;

            if ($$.isArray(type)) {
                for (var i = 0; i < type.length; i++) {
                    var actualType = type[i];

                    if (container instanceof actualType) {
                        found = true;
                        break;
                    }
                }
            } else {
                found = (container instanceof type);
            }

            // If the container exists and is of the requested type return it
            if (found) {
                return container;
            } else {
                // If there's a parent context search for the container type on it
                var parentContext = context.$parentContext;

                if (parentContext) {
                    return self.findContainer(parentContext, type);
                }
            }
        }
    }

    return new Utils();
});

define('text!qk-alchemy/components/layout.component.html',[],function () { return '<!-- quark-component -->\r\n    <!-- ko content -->\r\n    <!-- /ko -->\r\n<!-- /ko -->\r\n';});

/**
    @component
    Allows to define the general layout of the page. It coordinates the navbar,
    sidebar and main container and interactions between them.
    <br/>
    For example, this is a layout with a navbar and sidebar
    &lt;quark-component&lt;
        &lt;al-layout&lt;
            &lt;al-layout-sidebar&lt;
            &lt;/al-layout-sidebar&lt;

            &lt;al-layout-container&lt;
            &lt;/al-layout-container&lt;
        &lt;/al-layout&lt;
    &lt;/quark-component&lt;
    @allowContent
*/
define('qk-alchemy/components/layout.component',[
    'quark',
    'knockout',
    'text!./layout.component.html'
], function($$, ko, template) {

    function LayoutComponent(params, $scope, $imports) {
        var self = this;

        /**
            @property bool True if the layout contains a al-layout-navbar component.
            Do not set this property by code.
            @observable
        */
        this.hasNavbar = ko.observable(false);
        /**
            @property bool True if the layout has a al-layout-sidebar component.
            Do not set this property by code.
            @observable
        */
        this.hasSidebar = ko.observable(false);
        /**
            @property bool True if the layout has a al-layout-submenu component.
            Do not set this property by code.
            @observable
        */
        this.hasSubmenu = ko.observable(false);

        $$.parameters({
            /**
                @parameter int sidebar's width in pixels, sidebar's max size is
                half the window
                @observable @exposed
            */
            sidebarSize: ko.observable(90),
            /**
                @parameter string Bootstrap size with the breaking point of the main container.
                When the viewport is less than this size the sidebar breaks above
                the main content.
                @observable @exposed
            */
            containerSize: ko.observable('md'),
            /**
                @parameter int Minimal width of the sidebar in pixels
                @observable @exposed
            */
            minSidebarSize: ko.observable(20),
            /**
                @parameter bool True if the container is fluid
                @observable @exposed
            */
            containerFluid: ko.observable(true)
        }, params, this);

        // On component init
        $imports.initComponent = function() {
            // Validate sidebar size and apply body margin
            validateSize(self.sidebarSize());
            setBodyMargin(self.hasNavbar());
        }

        // Limit sidebar size
        function validateSize() {
            var size = self.sidebarSize();
            var minSize = self.minSidebarSize();
            var maxSize = $(window).width() / 2;

            if ($$.isNumeric(minSize) && minSize > 0 && size < minSize) {
                self.sidebarSize(minSize);
            }

            if (size < 0) {
                self.sidebarSize(0);
            }

            if (size > maxSize) {
                self.sidebarSize(maxSize);
            }
        }

        // Applies the body margin if it has a navbar
        function setBodyMargin(hasNavbar) {
            if (hasNavbar) {
                $(document).css('padding-top', '50px');
            } else {
                $(document).css('padding-top', 'auto');
            }
        }

        var subscriptions = {
            // Validate sidebar size on size change
            sidebarSize: self.sidebarSize.subscribe(validateSize),
            // Validate sidebar size on min size change
            minSidebarSize: self.minSidebarSize.subscribe(validateSize),
            // Apply body margin when hasNavbar changes
            hasNavbar: self.hasNavbar.subscribe(setBodyMargin)
        };

        // Cleans component on dispose
        $scope.dispose = function() {
            subscriptions.sidebarSize.dispose();
            subscriptions.minSidebarSize.dispose();
            subscriptions.hasNavbar.dispose();
        }
    }

    return $$.component(LayoutComponent, template)
})
;
/**
    @component Defines the navbar of the page. It must be used inside a al-layout
    component. This component allows to define the elements that shows on the page's
    navbar. It can define two virtual containers, left and right, elements on each
    container will be aligned respectively. <br/>
    For example: <br/>
    <code-highlight params="language: 'html'">
        &lt;al-layout&gt;
            &lt;al-layout-navbar&gt;
                &lt;-- left --&gt;
                    <al-layout-navbar-link params="text: 'Left Aligned'" virtual>
                    </al-layout-navbar-link>
                &lt;-- /left --&gt;
                &lt;-- right --&gt;
                    <al-layout-navbar-link params="text: 'Right Aligned'" virtual>
                    </al-layout-navbar-link>
                &lt;-- /right --&gt;
            &lt;/al-layout-navbar&gt;
        &lt;/al-layout&gt;
    </code-highlight>
    All components inside the navbar must be virtual
    @allowContent
*/
define('qk-alchemy/components/layout/navbar.component',[
    'knockout',
    'quark',
    'text!./navbar.component.html',
    '../../lib/utils',
    '../layout.component'
], function(ko, $$, template, utils, LayoutComponent) {

    function LayoutNavbarComponent(params, $scope) {
        var self = this;

        var hasNavbar;

        // Component's parameters
        $$.parameters({
            /**
                @parameter string Page name to link when the user clicks on the brand
                @observable @exposed
            */
            pageName: ko.observable(),
            /**
                @parameter object Object with parameters values for the link when the user
                clicks on the brand. Empty if the page hasn't parameters.
            */
            pageParams: ko.observable(),
            /**
                @parameter string Brand name to show on the navbar
            */
            brand: ko.observable('Brand Name'),
            /**
                @parameter string URL to the icon to show on the brand
            */
            icon: ko.observable()
        }, params, this);

        // When binding the main div
        $scope.init = function(element, viewModel, context) {
            // Get the main layout component
            var layoutMain = utils.findContainer(context, LayoutComponent.modelType);;

            // Set the main layout component hasNavbar property to true
            if (layoutMain) {
                hasNavbar = layoutMain.hasNavbar;
                hasNavbar(true);
            } else {
                throw new Error('The navbar component must be used inside an al-layout component');
            }
        }

        // Return true if an icon is defined
        $scope.visibleIcon = ko.pureComputed(function() {
            return $$.isString(self.icon());
        }, $scope);

        // Get the icon type, font or image based on the icon property
        // first chars
        $scope.iconType = ko.pureComputed(function() {
            var icon = self.icon();

            if ($$.isString(icon)) {
                if (icon.substring(0, 4) == 'url:') {
                    return "image";
                } else if (icon.substring(0, 5) == 'font:') {
                    return "font";
                }
            }

            return "unknown";
        }, $scope);

        // Based on icon type returns the icon Url or class
        $scope.iconUrl = ko.pureComputed(function() {
            var type = $scope.iconType();
            var icon = self.icon();

            if (type == "image") {
                return icon.substring(4);
            } if (type == "font") {
                return icon.substring(5);
            } else {
                return icon;
            }
        }, $scope);

        $scope.url = ko.pureComputed(function() {
            var pageName = self.pageName();
            var pageParams = self.pageParams();

            if (pageName) {
                return '#' + $$.routing.hash(pageName, pageParams);
            }
        });

        this.dispose = function() {
            // Inform the main layout that a navbar is no longer available
            hasNavbar(false);
        }
    }

    return $$.component(LayoutNavbarComponent, template);
});

define('text!qk-alchemy/components/layout/navbar/button.component.html',[],function () { return '<!-- quark-component -->\r\n    <li data-bind="onBind: init,\r\n                   css: { active: model.active }">\r\n        <a href="#" data-bind="click: click">\r\n            <!-- ko if: model.iconFont -->\r\n                <span data-bind="css: model.iconFont"></span>&nbsp;\r\n            <!-- /ko -->\r\n            <!-- ko if: model.text -->\r\n                <span data-bind="text: model.text"></span>\r\n            <!-- /ko -->\r\n        </a>\r\n    </li>\r\n<!-- /quark-component -->\r\n';});

/**
    @component Shows a button on the navbar. It must be used inside an al-layout-navbar
    component as virtual.
*/
define('qk-alchemy/components/layout/navbar/button.component',[
    'knockout',
    'quark',
    'text!./button.component.html',
    '../../../lib/utils',
    '../navbar.component'
], function(ko, $$, template, utils, Navbar) {

    function LayoutNavbarButtonComponent(params, $scope) {
        var self = this;

        $$.parameters({
            /**
                @parameter string Text to show on the button
                @observable @exposed
            */
            text: ko.observable('Navbar Button'),
            /**
                @parameter string Class of the icon font to show on the element
                @observable @exposed
            */
            iconFont: ko.observable('glyphicon glyphicon-star'),
            /**
                @parameter bool True if the button must show as active on the navbar
                @observable @exposed
            */
            active: ko.observable(false),
            /**
                @parameter callback Called when the user clicks on the button
            */
            onClick: function() {}
        }, params, this);

        // On components init
        $scope.init = function(element, viewModel, context) {
            // Gets the model of the container component
            var container = utils.findContainer(context, Navbar.modelType);

            // Check if its a Navbar component
            if (!container) {
                throw new Error('This component must be used inside an al-layout-navbar component');
            }
        }

        $scope.click = function() {
            $$.call(self.onClick);
        }
    }

    return $$.component(LayoutNavbarButtonComponent, template);
});

define('text!qk-alchemy/components/layout/navbar/dropdown.component.html',[],function () { return '<!-- quark-component -->\r\n    <li class="dropdown" data-bind="onBind: init, css: { active: model.active }">\r\n        <a href="#" class="dropdown-toggle" data-toggle="dropdown">\r\n            <!-- ko if: model.iconFont -->\r\n                <span data-bind="css: model.iconFont"></span>&nbsp;\r\n            <!-- /ko -->\r\n            <span data-bind="text: model.text"></span>\r\n            <span class="caret"></span>\r\n        </a>\r\n        <ul class="dropdown-menu">\r\n            <!-- ko content: \'*\' -->\r\n            <!-- /ko -->\r\n        </ul>\r\n    </li>\r\n<!-- /quark-component -->\r\n';});

/**
    @component Shows a dropdown button on the navbar. It must be used inside an al-layout-navbar
    component as virtual.
*/
define('qk-alchemy/components/layout/navbar/dropdown.component',[
    'knockout',
    'quark',
    'text!./dropdown.component.html',
    '../../../lib/utils',
    '../navbar.component'
], function(ko, $$, template, utils, Navbar) {

    function LayoutNavbarDropdownComponent(params, $scope) {
        var self = this;

        $$.parameters({
            /**
                @parameter string Class of the icon font to show on the element
                @observable @exposed
            */
            iconFont: ko.observable('glyphicon glyphicon-star'),
            /**
                @parameter string Text to show on the link
                @observable @exposed
            */
            text: ko.observable('Dropdown'),
            /**
                @parameter bool True if the button must show as active on the navbar
                @observable @exposed
            */
            active: ko.observable(false)
        }, params, this);

        // On components init
        $scope.init = function(element, viewModel, context) {
            // Gets the model of the container component
            var container = utils.findContainer(context, Navbar.modelType);

            // Check if its a Navbar component
            if (!container) {
                throw new Error('This component must be used inside an al-layout-navbar component');
            }
        }
    }

    return $$.component(LayoutNavbarDropdownComponent, template);
});

define('text!qk-alchemy/components/layout/navbar/dropdown/divider.component.html',[],function () { return '<!-- quark-component -->\r\n    <li data-bind="onBind: init" class="divider">\r\n    </li>\r\n<!-- /quark-component -->\r\n';});

/**
    @component Shows a divider line on the al-navbar-dropdown component.
*/
define('qk-alchemy/components/layout/navbar/dropdown/divider.component',[
    'knockout',
    'quark',
    'text!./divider.component.html',
    '../../../../lib/utils',
    '../dropdown.component'
], function(ko, $$, template, utils, NavbarDropdown) {

    function LayoutNavbarDropdownDividerComponent(params, $scope) {
        var self = this;

        // On components init
        $scope.init = function(element, viewModel, context) {
            // Gets the model of the container component
            var container = utils.findContainer(context, NavbarDropdown.modelType);

            // Check if its a Navbar component
            if (!container) {
                throw new Error('This component must be used inside an al-layout-navbar-dropdown component');
            }
        }
    }

    return $$.component(LayoutNavbarDropdownDividerComponent, template);
});

define('text!qk-alchemy/components/layout/navbar/dropdown/header.component.html',[],function () { return '<!-- quark-component -->\r\n    <li data-bind="onBind: init, text: model.text" class="dropdown-header">\r\n    </li>\r\n<!-- /quark-component -->\r\n';});

/**
    @component Shows a header text in the al-navbar-dropdown component.
*/
define('qk-alchemy/components/layout/navbar/dropdown/header.component',[
    'knockout',
    'quark',
    'text!./header.component.html',
    '../../../../lib/utils',
    '../dropdown.component'
], function(ko, $$, template, utils, NavbarDropdown) {

    function LayoutNavbarDropdownHeaderComponent(params, $scope) {
        var self = this;

        $$.parameters({
            /**
                @parameter string Text to show on the header
                @observable @exposed
            */
            text: ko.observable('Header')
        }, params, this);

        // On components init
        $scope.init = function(element, viewModel, context) {
            // Gets the model of the container component
            var container = utils.findContainer(context, NavbarDropdown.modelType);

            // Check if its a Navbar component
            if (!container) {
                throw new Error('This component must be used inside an al-layout-navbar-dropdown component');
            }
        }
    }

    return $$.component(LayoutNavbarDropdownHeaderComponent, template);
});

define('text!qk-alchemy/components/layout/navbar/dropdown/link.component.html',[],function () { return '<!-- quark-component -->\r\n    <li data-bind="onBind: init, css: { active: isActive, disabled: model.disabled }">\r\n        <a data-bind="attr: { href: url }">\r\n            <!-- ko if: model.iconFont -->\r\n                <span data-bind="css: model.iconFont"></span>&nbsp;\r\n            <!-- /ko -->\r\n\r\n            <span data-bind="text: model.text"></span>\r\n        </a>\r\n    </li>\r\n<!-- /quark-component -->\r\n';});

/**
    @component Shows a link in the al-navbar-dropdown component. Allows the user to click on the option
    redirecting the browser to a specific page.
*/
define('qk-alchemy/components/layout/navbar/dropdown/link.component',[
    'knockout',
    'quark',
    'text!./link.component.html',
    '../../../../lib/utils',
    '../dropdown.component'
], function(ko, $$, template, utils, NavbarDropdown) {

    function LayoutNavbarDropdownLinkComponent(params, $scope) {
        var self = this;

        $$.parameters({
            /**
                @parameter string Page name to redirect on click
                @observable @exposed
            */
            pageName: ko.observable(),
            /**
                @parameter object An object where each property is the name of a page parameter
                and contains its value
                @observable @exposed
            */
            pageParams: ko.observable(),
            /**
                @parameter string Class of the icon font to show on the element
                @observable @exposed
            */
            iconFont: ko.observable('glyphicon glyphicon-star'),
            /**
                @parameter string Text to show on the element.
                @observable @exposed
            */
            text: ko.observable('Navbar Link'),
            /**
                @parameter bool True if the item must be disabled, false otherwise.
            */
            disabled: ko.observable(false)
        }, params, this);

        var dropdownActive = ko.observable();

        function checkActive() {
            var current = $$.routing.current();

            if (current == self.pageName()) {
                dropdownActive(true);
                return true;
            }

            return false;
        }

        // On components init
        $scope.init = function(element, viewModel, context) {
            // Gets the model of the container component
            var container = utils.findContainer(context, NavbarDropdown.modelType);

            // Check if its a Navbar component
            if (container) {
                dropdownActive = container.active;
                checkActive();
            } else {
                throw new Error('This component must be used inside an al-layout-navbar-dropdown component');
            }
        }

        $scope.url = ko.pureComputed(function() {
            var pageName = self.pageName();
            var pageParams = self.pageParams();

            if (pageName) {
                return '#' + $$.routing.hash(pageName, pageParams);
            }
        }, $scope);

        $scope.isActive = ko.computed(function() {
            return checkActive();
        }, $scope);

        $scope.dispose = function() {
            $scope.isActive.dispose();
        }
    }

    return $$.component(LayoutNavbarDropdownLinkComponent, template);
});

define('text!qk-alchemy/components/layout/navbar/link.component.html',[],function () { return '<!-- quark-component -->\r\n    <li data-bind="onBind: init, css: { active: isActive }">\r\n        <a data-bind="attr: { href: url }">\r\n            <!-- ko if: model.iconFont -->\r\n                <span data-bind="css: model.iconFont"></span>&nbsp;\r\n            <!-- /ko -->\r\n\r\n            <span data-bind="text: model.text"></span>\r\n        </a>\r\n    </li>\r\n<!-- /quark-component -->\r\n';});

/**
    @component Shows a link button on the navbar. It must be used inside an al-layout-navbar
    component as virtual.
*/
define('qk-alchemy/components/layout/navbar/link.component',[
    'knockout',
    'quark',
    'text!./link.component.html',
    '../../../lib/utils',
    '../navbar.component'
], function(ko, $$, template, utils, Navbar) {

    function LayoutNavbarLinkComponent(params, $scope) {
        var self = this;

        $$.parameters({
            /**
                @parameter string Page to link when the user clicks on the element
                @observable @exposed
            */
            pageName: ko.observable(),
            /**
                @parameter object Parameter of the page to link when the user clicks on the element
                @observable @exposed
            */
            pageParams: ko.observable(),
            /**
                @parameter string Class of the icon font to show on the element
                @observable @exposed
            */
            iconFont: ko.observable('glyphicon glyphicon-star'),
            /**
                @parameter string Text to show on the link
                @observable @exposed
            */
            text: ko.observable('Navbar Link')
        }, params, this);

        // On components init
        $scope.init = function(element, viewModel, context) {
            // Get the main layout component
            var container = utils.findContainer(context, Navbar.modelType);;

            // Check if its a Navbar component
            if (!(container instanceof Navbar.modelType)) {
                throw new Error('This component must be used inside an al-layout-navbar component');
            }
        }

        $scope.url = ko.pureComputed(function() {
            var pageName = self.pageName();
            var pageParams = self.pageParams();

            if (pageName) {
                return '#' + $$.routing.hash(pageName, pageParams);
            }
        }, $scope);

        $scope.isActive = ko.pureComputed(function() {
            var current = $$.routing.current();

            if (current == self.pageName()) {
                return true;
            }

            return false;
        }, $scope);
    }

    return $$.component(LayoutNavbarLinkComponent, template);
});
